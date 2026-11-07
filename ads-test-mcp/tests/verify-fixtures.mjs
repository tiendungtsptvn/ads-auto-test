// Dữ liệu dùng chung cho test report và test tích hợp của verify_ads (dữ liệu giả, sinh bằng code).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLogcat } from '../dist/core/logcat.js';
import { analyzeAds } from '../dist/core/ad-events.js';
import { extractConfig } from '../dist/core/config.js';
import { readAdScript } from '../dist/core/ad-script.js';
import { verifyAds } from '../dist/core/verify.js';
import { makeLog, tmpFile, configBlock, ID, loadStart, loadOk, loadErr, show } from './fixtures.mjs';
import { scriptSheetRows, sheetData, xlsxFile } from './xlsx-fixtures.mjs';

export const cfg = (checklist, prefs, t = '10:00:00.000') => configBlock(t, { prefs, checklist });

/** Chạy lõi đối chiếu trên dữ liệu trong bộ nhớ. */
export function scenario({ ads, log, acceptance }) {
  const script = readAdScript(sheetData(scriptSheetRows(ads)));
  const parsed = parseLogcat(makeLog(log));
  const l = { parsed, ads: analyzeAds(parsed.entries), config: extractConfig(parsed.entries) };
  return verifyAds({ script, log: l, acceptance });
}

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ads-test-verify-'));

/**
 * Bộ file giả cho test tích hợp:
 *  dòng 5  ad_ok        : có trong log, load, ok, show        -> OK
 *  dòng 6  ad_gone      : không có trong log                  -> FAIL (present)
 *  dòng 7  reward_ad    : load hai lần liên tiếp rồi show     -> FAIL (load_once)
 *  dòng 8  mix_ad       : case đặc biệt MIX                    -> CẦN XEM
 *  log còn có một ad id không có trong kịch bản              -> ad thừa
 */
export async function integrationFiles({ withAcceptance = false } = {}) {
  const ads = [
    { screen: 'Splash', name: 'ad_ok', res: 'fo_ad_ok', key: 'k_ok', id: ID(1) },
    { name: 'ad_gone', res: 'fo_ad_gone', key: 'k_gone', id: ID(2) },
    { name: 'reward_ad', res: 'fo_reward', key: 'k_rw', id: ID(3), type: 'Reward' },
    { name: 'mix_ad_2ID', res: 'fo_na_mix_after_01_2', id: ID(4) },
  ];
  const log = makeLog([
    ...cfg(
      { S: { fo_ad_ok: ID(1), fo_ad_gone: ID(2), fo_reward: ID(3), fo_na_mix_after_01_2: ID(4) } },
      { k_ok: 'true', k_gone: 'true', k_rw: 'true', fo_inter_splash: 'true' },
    ),
    loadStart('10:00:01.000', 'Native', ID(1)),
    loadOk('10:00:02.000', 'Native', ID(1)),
    show('10:00:03.000', 'NATIVE', ID(1)),
    loadStart('10:00:04.000', 'Reward', ID(3)),
    loadStart('10:00:05.000', 'Reward', ID(3)),
    loadOk('10:00:06.000', 'Reward', ID(3)),
    show('10:00:07.000', 'REWARDED', ID(3)),
    loadStart('10:00:08.000', 'Native', ID(4)),
    loadErr('10:00:09.000', 'Native', ID(4)),
    loadStart('10:00:10.000', 'Banner', ID(50)),
  ]);

  const dir = tmpDir();
  const logPath = path.join(dir, 'logcat.txt');
  fs.writeFileSync(logPath, log);
  const xlsxPath = await xlsxFile([{ name: 'Phase 8', rows: scriptSheetRows(ads) }], 'kich-ban.xlsx');
  const files = { dir, logPath, xlsxPath };

  if (withAcceptance) {
    files.acceptancePath = await xlsxFile(
      [
        {
          name: 'Nghiệm thu',
          rows: [
            [],
            [],
            [undefined, undefined, 'Tên ad', 'Key remote', 'Tiền điều kiện', 'Mô tả', 'Mô tả ID', 'Ví dụ log'],
            [undefined, undefined, 'Ad native splash', 'fo_logic_ad_launcher\nlogic_na_fu_alt', undefined, undefined, 'Lấy các ID Ad:\n- fo_na_mix_after_01: ...', 'https://example.com/anh.png'],
            [undefined, undefined, undefined, undefined, '1. fo_inter_splash = TRUE', 'Bật ad', 'Show ad MIX'],
          ],
        },
      ],
      'nghiem-thu.xlsx',
    );
  }
  return files;
}
