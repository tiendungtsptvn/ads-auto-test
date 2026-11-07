import { TESTER_TAG_PREFIX } from './logcat.js';
import { isSecretKey } from './mask.js';
const PREFS_HEADER_RE = /^=+\s*Remote FO Prefs\s*=+$/i;
const RULE_ONLY_RE = /^[=═\-─\s]+$/;
const CHECKLIST_TITLE = 'FO CONFIG CHECKLIST';
const SECTION_RE = /^\[([^\]]+)\]$/;
const VERSION_LIB_RE = /^Version Lib ([A-Za-z0-9 ]+?):\s*(\S.*)$/;
const MASKED = '***';
function splitKeyValue(line) {
    const idx = line.indexOf(':');
    if (idx <= 0)
        return undefined;
    const key = line.slice(0, idx).trim();
    if (!key || /\s/.test(key))
        return undefined;
    let value = line.slice(idx + 1).trim();
    if (value === '(empty)')
        value = '';
    return [key, isSecretKey(key) ? MASKED : value];
}
export function extractConfig(entries) {
    const info = { libVersions: {}, snapshots: [] };
    let snap;
    let section = '';
    let inChecklist = false;
    /** Sau tiêu đề checklist có một dòng kẻ ═ mở đầu, rồi các section, rồi một dòng kẻ ═ kết thúc. */
    let checklistRulesLeft = 0;
    const newSnapshot = (e) => {
        const s = {
            time: e.time,
            line: e.line,
            prefs: {},
            checklist: {},
            checklistSection: {},
        };
        info.snapshots.push(s);
        return s;
    };
    for (const e of entries) {
        if (e.tag !== `${TESTER_TAG_PREFIX}CONFIG`)
            continue;
        const msg = e.message;
        const ver = VERSION_LIB_RE.exec(msg);
        if (ver) {
            const name = ver[1].trim();
            if (name.toUpperCase() === 'FIRST OPEN')
                info.libVersion = ver[2].trim();
            else
                info.libVersions[name] = ver[2].trim();
            continue;
        }
        if (PREFS_HEADER_RE.test(msg)) {
            snap = newSnapshot(e);
            inChecklist = false;
            for (const line of e.extra) {
                if (RULE_ONLY_RE.test(line))
                    break;
                const kv = splitKeyValue(line);
                if (kv)
                    snap.prefs[kv[0]] = kv[1];
            }
            continue;
        }
        if (msg === CHECKLIST_TITLE) {
            if (!snap || Object.keys(snap.checklist).length > 0)
                snap = newSnapshot(e);
            inChecklist = true;
            section = '';
            checklistRulesLeft = 1;
            continue;
        }
        if (!inChecklist || !snap)
            continue;
        if (RULE_ONLY_RE.test(msg)) {
            // Dòng kẻ ngay sau tiêu đề thì bỏ qua; dòng kẻ sau các section thì kết thúc checklist.
            if (checklistRulesLeft > 0)
                checklistRulesLeft--;
            else
                inChecklist = false;
            continue;
        }
        const sec = SECTION_RE.exec(msg);
        if (sec) {
            section = sec[1];
            continue;
        }
        const kv = splitKeyValue(msg);
        if (kv) {
            snap.checklist[kv[0]] = kv[1];
            snap.checklistSection[kv[0]] = section;
        }
        else {
            inChecklist = false;
        }
    }
    return info;
}
//# sourceMappingURL=config.js.map