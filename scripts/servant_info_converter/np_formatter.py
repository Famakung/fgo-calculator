import re

from .effect_map import (
    CLASS_TRAIT_IDS,
    NP_TYPE_MAP,
    TARGET_LABELS,
    TRAIT_ID_LABELS,
)
from .utils import (
    CARD_NAMES,
    NP_GAIN_CARD_KEY,
    INDIVIDUALITIE_IGNORE,
    oc_last,
    fmt_trait_name,
    fmt_condition,
    fmt_quest_field_target,
    is_demerit,
    apply_tvals_target,
    group_and_label_items,
    is_mash,
    fold_chained_functions,
    append_chained_roll_tag,
)
from .context import FetchContext
from .function_formatter import fmt_function

DAMAGE_FUNC_TYPES = {
    "damageNp",
    "damageNpIndividual",
    "damageNpIndividualSum",
    "damageNpPierce",
    "damageNpRare",
    "damageNpBattlePointPhase",
    "damageNpStateIndividualFix",
    "damageNpAndOrCheckIndividuality",
    "damageNpHpratioLow",
    "damageNpHpratioHigh",
}


def fmt_np_function(fn, np_individuality_trait=None, ctx=None) -> str | None:
    func_type = fn["funcType"]
    target_type = fn["funcTargetType"]
    svals = fn.get("svals", [])
    if func_type == "moveToLastSubmember":
        return "Retreat to the sub-member slot <cannot retreat if there is only 1 allied Servant on the field>"
    target = TARGET_LABELS.get(target_type, target_type)
    tvals = fn.get("functvals", [])
    if tvals:
        target = apply_tvals_target(target, tvals)
    np_buffs = fn.get("buffs", [])
    target = fmt_quest_field_target(fn, target)
    quest_fields = fn.get("funcquestTvals", [])
    if not quest_fields and np_buffs:
        indv = np_buffs[0].get("script", {}).get("INDIVIDUALITIE")
        if indv and indv.get("id") not in INDIVIDUALITIE_IGNORE:
            target = f"only when on a [{fmt_trait_name(indv)}] field {target}"
    dmg_target = {
        "enemyAll": "to all enemies",
        "enemyOne": "to a single enemy",
        "enemy": "to a single enemy",
    }.get(target_type, target)
    damage_word = "heavy" if target_type == "enemyAll" else "significant"
    sv0 = svals[0] if svals else {}
    sv_np5 = svals[-1] if svals else {}

    if func_type == "gainNp":
        sv_oc5 = oc_last(fn, svals)
        val_oc1, val_oc5 = sv0.get("Value", 0) // 100, sv_oc5.get("Value", 0) // 100
        if val_oc1 != val_oc5:
            return f"Increase NP Gauge by {val_oc1}-{val_oc5}% <effect increases with Overcharge> {target}{' [Demerit]' if is_demerit(fn) else ''}"

    if func_type == "gainHp":
        sv_oc5 = oc_last(fn, svals)
        val_oc1, val_oc5 = sv0.get("Value", 0), sv_oc5.get("Value", 0)
        if val_oc1 != val_oc5:
            return f"Restore HP by {val_oc1}-{val_oc5} <effect increases with Overcharge> {target}"

    if func_type == "instantDeath":
        sv_oc5 = oc_last(fn, svals)
        rate_oc1, rate_oc5 = sv0.get("Rate", 0) // 10, sv_oc5.get("Rate", 0) // 10
        if rate_oc1 != rate_oc5:
            return f"{rate_oc1}-{rate_oc5}% Chance to Inflict Death <effect increases with Overcharge> {target}"
    if func_type == "subState" and fn.get("traitVals"):
        trait_labels = []
        is_buff_trait = False
        for t in fn["traitVals"]:
            tid = t.get("id")
            label = TRAIT_ID_LABELS.get(tid, fmt_trait_name(t))
            if tid == 2911 or "buff" in t.get("name", "").lower():
                is_buff_trait = True
            trait_labels.append(label)
        if is_buff_trait:
            lowered = ", ".join(l.replace("Buffs", "buffs") for l in trait_labels)
            return f"Remove {lowered} {target}"
        return f"Remove {', '.join(trait_labels)} {target}"
    if func_type in DAMAGE_FUNC_TYPES:
        val_np1, val_np5 = sv0.get("Value", 0) // 10, sv_np5.get("Value", 0) // 10
        val_str = f"{val_np1}-{val_np5}" if val_np1 != val_np5 else str(val_np1)
        template = NP_TYPE_MAP.get(func_type)
        if func_type == "damageNpIndividualSum":
            max_count = sv0.get("ParamAddMaxCount", 0)
            if max_count == 0:
                template = template.get(
                    "flat",
                    "Deal {damage_word} Special Attack {trait} by {corr_str}% damage{oc_tag} by {val_str}% <effect increases with Level> {dmg_target}",
                )
            else:
                template = template.get(sv0.get("Target", 1), template[1])
        if template:
            sv_oc5 = oc_last(fn, svals)
            if func_type in ("damageNpHpratioLow", "damageNpHpratioHigh"):
                corr_val0 = sv0.get("Target", 0)
                corr_val_oc5 = sv_oc5.get("Target", 0)
            else:
                corr_val0 = sv0.get("Correction") or sv0.get("Value2", 0)
                corr_val_oc5 = sv_oc5.get("Correction") or sv_oc5.get("Value2", 0)
            corr_oc1, corr_oc5 = (
                corr_val0 // 10,
                corr_val_oc5 // 10,
            )
            corr_str = (
                f"{corr_oc1}-{corr_oc5}" if corr_oc1 != corr_oc5 else str(corr_oc1)
            )
            if func_type in ("damageNpHpratioLow", "damageNpHpratioHigh"):
                oc_tag = (
                    " <strength increases with Overcharge>"
                    if corr_oc1 != corr_oc5
                    else ""
                )
            else:
                oc_tag = (
                    " <Special Attack damage increases with Overcharge>"
                    if corr_oc1 != corr_oc5
                    else ""
                )
            if func_type == "damageNpAndOrCheckIndividuality":
                and_list = sv0.get("AndCheckIndividualityList") or []
                or_list = sv0.get("OrCheckIndividualityList") or []
                if and_list:
                    class_traits = [t for t in and_list if t in CLASS_TRAIT_IDS]
                    if 1000 in and_list and class_traits:
                        cls_name = TRAIT_ID_LABELS.get(class_traits[0], "Unknown")
                        other = [
                            t for t in and_list if t != 1000 and t != class_traits[0]
                        ]
                        if other:
                            other_str = " with ".join(
                                TRAIT_ID_LABELS.get(t, f"{t}:Unknown") for t in other
                            )
                            trait = f"{cls_name}-class Servant with {other_str}"
                        else:
                            trait = f"{cls_name}-class Servant"
                    else:
                        trait = " with ".join(
                            TRAIT_ID_LABELS.get(t, f"{t}:Unknown") for t in and_list
                        )
                elif or_list:
                    labels = []
                    for t in or_list:
                        lbl = TRAIT_ID_LABELS.get(t, f"{t}:Unknown")
                        if lbl not in labels:
                            labels.append(lbl)
                    trait = " or ".join(labels)
                else:
                    trait_id = sv0.get("Target")
                    trait = (
                        TRAIT_ID_LABELS.get(trait_id, f"{trait_id}:Unknown")
                        if trait_id
                        else ""
                    )
            elif func_type == "damageNpIndividualSum":
                max_count = sv0.get("ParamAddMaxCount", 0)
                if max_count == 0:
                    target_list = sv0.get("TargetList") or []
                    if target_list:
                        trait = " or ".join(
                            f"[{TRAIT_ID_LABELS.get(t, f'{t}:Unknown')}]"
                            for t in target_list
                        )
                    else:
                        trait_id = sv0.get("Target")
                        trait = (
                            f"[{TRAIT_ID_LABELS.get(trait_id, f'{trait_id}:Unknown')}]"
                            if trait_id
                            else ""
                        )
                else:
                    trait_id = sv0.get("TargetList", [None])[0]
                    trait = (
                        TRAIT_ID_LABELS.get(trait_id, f"{trait_id}:Unknown")
                        if trait_id
                        else ""
                    )
            elif func_type == "damageNpRare":
                trait = "Low Rarity"
            elif func_type in ("damageNpHpratioLow", "damageNpHpratioHigh", "damageNpBattlePointPhase"):
                trait = ""
            else:
                trait_id = sv0.get("Target")
                trait = (
                    TRAIT_ID_LABELS.get(trait_id, f"{trait_id}:Unknown")
                    if trait_id
                    else ""
                )
            return template.format(
                damage_word=damage_word,
                val_str=val_str,
                dmg_target=dmg_target,
                trait=trait,
                corr_str=corr_str,
                max_count=sv0.get("ParamAddMaxCount", 1),
                oc_tag=oc_tag,
            )
    if fn.get("buffs") and svals:
        sv_oc5 = oc_last(fn, svals)
        val_oc1, val_oc5 = svals[0].get("Value"), sv_oc5.get("Value")
        if val_oc1 is not None and val_oc5 is not None and val_oc1 != val_oc5:
            res = fmt_function(fn, sv_start=svals[0], sv_end=sv_oc5, ctx=ctx)
            if res:
                return f"{res} <effect increases with Overcharge>"
    if func_type == "forceInstantDeath":
        trait_str = f" [{np_individuality_trait}]" if np_individuality_trait else ""
        bare_target = target[4:] if target.startswith("for ") else target
        return f"Apply Death for{trait_str} {bare_target}{' [Demerit]' if is_demerit(fn) else ''}"
    buffs = fn.get("buffs", [])
    if buffs and buffs[0].get("type") == "addIndividuality":
        sv0 = svals[0] if svals else {}
        val = sv0.get("Value")
        if not val or sv0.get("ShowState") == -1 or sv0.get("HideNoEffect") == 1:
            return None
        trait_name = TRAIT_ID_LABELS.get(val, f"{val}:Unknown")
        cond = fmt_condition(sv0.get("Turn", -1), sv0.get("Count", -1))
        return f"Apply [{trait_name}]{' ' + cond if cond else ''} {target}"
    if fn.get("buffs") and svals:
        sv0, sv9 = svals[0], svals[-1]
        val_lv1, val_lv9 = sv0.get("Value"), sv9.get("Value")
        if val_lv1 is not None and val_lv9 is not None and val_lv1 != val_lv9:
            res = fmt_function(fn, sv_start=sv0, sv_end=sv9, ctx=ctx)
            if res:
                return f"{res} <effect increases with Level>"
    return fmt_function(fn, ctx=ctx)


def _extract_single_np_data(np_data, ctx=None) -> dict:
    card_key = str(np_data.get("card", ""))
    card_name = CARD_NAMES.get(card_key, card_key.capitalize() if card_key else "")
    hits = len(np_data.get("npDistribution", []))
    functions = np_data.get("functions", [])
    if ctx is None:
        ctx = FetchContext(functions=functions)
    else:
        ctx.functions = functions
    flags = np_data.get("effectFlags", [])
    scope = (
        "AOE"
        if "attackEnemyAll" in flags
        else ("Single-Target" if any("attackEnemy" in f for f in flags) else "")
    )
    hits_str = (
        f"{hits} {'Hit' if hits == 1 else 'Hits'}"
        if any(fn.get("funcType") in DAMAGE_FUNC_TYPES for fn in functions)
        else "Special"
    )
    type_line = " ".join(p for p in [card_name, scope, hits_str] if p)
    np_gain_dict = np_data.get("npGain") or {}
    gain_list = np_gain_dict.get(NP_GAIN_CARD_KEY.get(card_key, "arts")) or [0]
    gain_val = gain_list[0] if gain_list else 0
    gain_line = f"NP Gain {gain_val / 100}%"
    meta_lines = [type_line, gain_line]

    fx_lines = []
    star_higher = np_data.get("script", {}).get("STAR_HIGHER")
    if star_higher:
        fx_lines.append(
            f"<Usable only when there are more than {star_higher[0]} Critical Stars>"
        )
    np_individuality_trait = None
    for fn in functions:
        if fn.get("buffs", []) and fn["buffs"][0].get("type") == "addIndividuality":
            trait_id = (fn.get("svals") or [{}])[0].get("Value")
            if trait_id:
                np_individuality_trait = TRAIT_ID_LABELS.get(
                    trait_id, f"{trait_id}:Unknown"
                )
            break
    for fn, count in fold_chained_functions(functions):
        res = fmt_np_function(
            fn, np_individuality_trait=np_individuality_trait, ctx=ctx
        )
        if res:
            if count > 1:
                res = append_chained_roll_tag(res, count)
            fx_lines.append(res)

    return {
        "name": np_data.get("name", ""),
        "card": card_name,
        "scope": scope,
        "hits": hits,
        "metaLines": meta_lines,
        "effects": fx_lines,
    }


def _fmt_single_np(np_data, label="Noble Phantasm", ctx=None) -> list:
    info = _extract_single_np_data(np_data, ctx=ctx)
    return ["", label, *info["metaLines"], *info["effects"]]


def _get_np_tier_from_title(title: str) -> int:
    m = re.search(r"\[(\d+)(?:st|nd|rd|th)\s+Strengthen\]", title, re.IGNORECASE)
    if m:
        return int(m.group(1))
    if "[Strengthen]" in title or "Strengthen]" in title:
        return 1
    return 0


def _normalize_noble_phantasms(nps):
    """Normalize variant Noble Phantasms (e.g. card changes from tdTypeChangeIDs)."""
    if not nps:
        return []
    primary_nps = [np for np in nps if np.get("num", 1) < 90]
    variant_nps = [np for np in nps if np.get("num", 1) >= 90]
    if not variant_nps:
        return nps

    norm_list = []
    for p in primary_nps:
        p_copy = dict(p)
        p_copy["_is_variant"] = False
        norm_list.append(p_copy)

    for v in variant_nps:
        v_copy = dict(v)
        v_copy["_is_variant"] = True
        vid = v.get("id")
        v_cond = v.get("condQuestId", 0)
        matched_p = None
        for p in primary_nps:
            cids = p.get("script", {}).get("tdTypeChangeIDs", [])
            if vid in cids:
                if p.get("condQuestId", 0) == v_cond:
                    matched_p = p
                    break
                elif matched_p is None:
                    matched_p = p
        if matched_p:
            v_copy["num"] = matched_p.get("num", 1)
            v_copy["strengthStatus"] = matched_p.get("strengthStatus", 0)
            v_copy["condQuestId"] = matched_p.get("condQuestId", 0)
        norm_list.append(v_copy)
    return norm_list


def _get_np_scope_type(np_data) -> str:
    """Resolve the scope or type (Special, AOE, Single-Target) of a Noble Phantasm."""
    funcs = np_data.get("functions", [])
    flags = np_data.get("effectFlags", [])
    is_dmg = any(fn.get("funcType") in DAMAGE_FUNC_TYPES for fn in funcs)
    if not is_dmg:
        return "Special"
    if "attackEnemyAll" in flags:
        return "AOE"
    if any("attackEnemy" in f for f in flags):
        return "Single-Target"
    return "Special"


def _resolve_np_variant_labels(np_list: list) -> list:
    """Dynamically generate human-readable variant labels for a list of Noble Phantasms."""
    if len(np_list) <= 1:
        return [None] * len(np_list)

    cards = [
        CARD_NAMES.get(str(d.get("card")), str(d.get("card")).capitalize())
        for d in np_list
    ]
    distinct_cards = len(set(cards)) == len(np_list) and len(set(cards)) > 1

    scopes = [_get_np_scope_type(d) for d in np_list]
    distinct_scopes = len(set(scopes)) == len(np_list) and len(set(scopes)) > 1

    labels = []
    for i in range(len(np_list)):
        if distinct_cards and distinct_scopes:
            labels.append(f"{cards[i]} {scopes[i]}")
        elif distinct_cards:
            labels.append(cards[i])
        elif distinct_scopes:
            labels.append(scopes[i])
        else:
            labels.append(f"Form {i+1}")
    return labels


def _fmt_mash_noble_phantasms_structured(nps, svt_id, ctx=None) -> list:
    np_map = {np["id"]: np for np in nps}

    paladin_np_ids = [800107, 800108]
    for np in nps:
        td_ids = np.get("script", {}).get("tdTypeChangeIDs", [])
        if len(td_ids) > 1 and any(nid in (800107, 800108) for nid in td_ids):
            paladin_np_ids = td_ids
            break

    paladin_nps = [np_map[nid] for nid in paladin_np_ids if nid in np_map]
    paladin_labels = _resolve_np_variant_labels(paladin_nps)

    tier0_forms = []
    np0_data = np_map.get(800101)
    if np0_data:
        info0 = _extract_single_np_data(np0_data, ctx=ctx)
        tier0_forms.append({
            "formIndex": 0,
            "label": "All Ascensions",
            "name": info0["name"],
            "metaLines": info0["metaLines"],
            "effects": info0["effects"],
        })

    np1_data = np_map.get(800105)
    if np1_data:
        info1 = _extract_single_np_data(np1_data, ctx=ctx)
        tier0_forms.append({
            "formIndex": 1,
            "label": "Spiritron Dress: Ortinax",
            "name": info1["name"],
            "metaLines": info1["metaLines"],
            "effects": info1["effects"],
        })

    paladin_options = []
    for p_idx, (p_np, p_lbl) in enumerate(zip(paladin_nps, paladin_labels)):
        p_info = _extract_single_np_data(p_np, ctx=ctx)
        paladin_options.append({
            "idx": p_idx,
            "label": p_lbl,
            "name": p_info["name"],
            "metaLines": p_info["metaLines"],
            "effects": p_info["effects"],
        })

    if paladin_options:
        tier0_forms.append({
            "formIndex": 2,
            "label": "Spiritron Dress: Paladin",
            "name": paladin_options[0]["name"],
            "metaLines": paladin_options[0]["metaLines"],
            "effects": paladin_options[0]["effects"],
            "options": paladin_options,
        })

    var0 = {
        "tier": 0,
        "type": "np",
        "rawTitle": "Noble Phantasm",
        "cleanTitle": "Noble Phantasm",
        "metaLines": tier0_forms[0]["metaLines"] if tier0_forms else [],
        "effects": [],
        "forms": tier0_forms,
    }

    tier1_forms = []
    np_st0 = np_map.get(800104)
    if np_st0:
        info_st0 = _extract_single_np_data(np_st0, ctx=ctx)
        tier1_forms.append({
            "formIndex": 0,
            "label": "All Ascensions",
            "name": info_st0["name"],
            "metaLines": info_st0["metaLines"],
            "effects": info_st0["effects"],
        })
    np_st1 = np_map.get(800106)
    if np_st1:
        info_st1 = _extract_single_np_data(np_st1, ctx=ctx)
        tier1_forms.append({
            "formIndex": 1,
            "label": "Spiritron Dress: Ortinax",
            "name": info_st1["name"],
            "metaLines": info_st1["metaLines"],
            "effects": info_st1["effects"],
        })

    var1 = {
        "tier": 1,
        "type": "np",
        "rawTitle": "Noble Phantasm [Strengthen]",
        "cleanTitle": "Noble Phantasm",
        "metaLines": tier1_forms[0]["metaLines"] if tier1_forms else [],
        "effects": [],
        "forms": tier1_forms,
    }

    slot_obj = {
        "slotKey": "np_1",
        "type": "np",
        "variantsByTier": {0: var0, 1: var1},
        "tiers": [0, 1],
        "maxTier": 1,
        "activeTier": 1,
    }
    return [slot_obj]


def _pick_preferred_np(candidates):
    """Pick the best representative NP when collapsing duplicate-effect entries."""
    def _key(item):
        np_data, _label, _asc, info = item
        nm = (info.get("name") or "").strip()
        has_real_name = 1 if (nm and nm != "???") else 0
        return (has_real_name, np_data.get("priority", 0), np_data.get("id", 0))

    return max(candidates, key=_key)


def format_np_structured(
    nps,
    svt_id,
    ctx=None,
    transform_nps=None,
    transform_svt_id=None,
) -> list:
    if not nps:
        return []
    if is_mash(svt_id):
        return _fmt_mash_noble_phantasms_structured(nps, svt_id, ctx=ctx)

    nps = _normalize_noble_phantasms(nps)
    items = group_and_label_items(nps, svt_id, "Noble Phantasm", include_num=False)

    has_diff_trans = False
    if transform_nps:
        base_np_ids = {np_data.get("id") for np_data in nps}
        diff_trans_items = [
            np_data
            for np_data in transform_nps
            if np_data.get("id") not in base_np_ids and np_data.get("functions")
        ]
        if diff_trans_items:
            has_diff_trans = True

    if not has_diff_trans:
        sub_groups = []
        curr_group = []
        curr_key = None
        for np_data, label in items:
            key = np_data.get("strengthStatus", 0)
            if curr_key is not None and key != curr_key:
                sub_groups.append((curr_key, curr_group))
                curr_group = []
            curr_key = key
            curr_group.append((np_data, label))
        if curr_group:
            sub_groups.append((curr_key, curr_group))

        slot_obj = {
            "slotKey": "np_1",
            "type": "np",
            "variantsByTier": {},
            "tiers": [],
            "maxTier": 0,
            "activeTier": 0,
        }

        for ss, grp in sub_groups:
            label0 = grp[0][1]
            tier = _get_np_tier_from_title(label0)

            non_empty = [pair for pair in grp if pair[0].get("functions")]
            if non_empty:
                grp = non_empty

            extracted = []
            for np_data, label in grp:
                asc_match = re.search(r"\[(.* Ascension)\]", label)
                asc_str = asc_match.group(1) if asc_match else None
                info = _extract_single_np_data(np_data, ctx=ctx)
                extracted.append((np_data, label, asc_str, info))

            by_asc_sig = {}
            for item in extracted:
                _np_data, _label, asc_str, info = item
                sig = (asc_str, tuple(info["metaLines"]), tuple(info["effects"]))
                by_asc_sig.setdefault(sig, []).append(item)
            deduped = [_pick_preferred_np(cands) for cands in by_asc_sig.values()]

            if len(deduped) > 1:
                effect_sigs = {
                    (tuple(info["metaLines"]), tuple(info["effects"]))
                    for _np_data, _label, _asc, info in deduped
                }
                if len(effect_sigs) == 1:
                    deduped = [_pick_preferred_np(deduped)]

            if len(deduped) > 1:
                tag = ""
                if " [Strengthen]" in label0:
                    tag = " [Strengthen]"
                elif " Strengthen]" in label0:
                    m = re.search(r"(\[\d+.*?Strengthen\])", label0)
                    if m:
                        tag = f" {m.group(1)}"
                header = f"Noble Phantasm{tag}"

                grp_nps = [d for d, _, _, _ in deduped]
                variant_labels = _resolve_np_variant_labels(grp_nps)

                forms = []
                for idx, (np_data, label, asc_str, info) in enumerate(deduped):
                    form_label = asc_str if asc_str else variant_labels[idx]
                    forms.append({
                        "formIndex": idx,
                        "label": form_label,
                        "name": info["name"],
                        "metaLines": info["metaLines"],
                        "effects": info["effects"],
                    })

                var = {
                    "tier": tier,
                    "type": "np",
                    "rawTitle": header,
                    "cleanTitle": "Noble Phantasm",
                    "metaLines": forms[0]["metaLines"],
                    "effects": [],
                    "forms": forms,
                }
            else:
                np_data, label, asc_str, info = deduped[0]
                raw_title = re.sub(r"\s+\[[^\]]*Ascension\]$", "", label) if asc_str else label
                clean_title = (
                    f"Noble Phantasm ({info['name']})" if info["name"] else "Noble Phantasm"
                )
                var = {
                    "tier": tier,
                    "type": "np",
                    "rawTitle": raw_title,
                    "cleanTitle": clean_title,
                    "name": info["name"],
                    "metaLines": info["metaLines"],
                    "effects": info["effects"],
                    "forms": [],
                }

            slot_obj["variantsByTier"][tier] = var
            if tier not in slot_obj["tiers"]:
                slot_obj["tiers"].append(tier)

        slot_obj["tiers"].sort()
        slot_obj["maxTier"] = max(slot_obj["tiers"]) if slot_obj["tiers"] else 0
        slot_obj["activeTier"] = slot_obj["maxTier"]
        return [slot_obj]

    # Transform servants
    main_name = TRAIT_ID_LABELS.get(svt_id, "Form 1")
    trans_name = TRAIT_ID_LABELS.get(transform_svt_id, "Form 2")

    trans_items = (
        group_and_label_items(
            transform_nps, transform_svt_id, "Noble Phantasm", include_num=False
        )
        if transform_nps
        else []
    )
    base_np_ids = {np_data.get("id") for np_data in nps}
    trans_nps_diff = [
        (np_data, label)
        for np_data, label in trans_items
        if np_data.get("id") not in base_np_ids and np_data.get("functions")
    ]

    slot_obj = {
        "slotKey": "np_1",
        "type": "np",
        "variantsByTier": {},
        "tiers": [],
        "maxTier": 0,
        "activeTier": 0,
    }

    for idx, (np_data, label) in enumerate(items):
        tag = label[label.find("[") :] if "[" in label else ""
        header = f"Noble Phantasm{' ' if tag else ''}{tag}"
        tier = _get_np_tier_from_title(header)

        info0 = _extract_single_np_data(np_data, ctx=ctx)
        forms = [
            {
                "formIndex": 0,
                "label": f"If {main_name}",
                "name": info0["name"],
                "metaLines": info0["metaLines"],
                "effects": info0["effects"],
            }
        ]

        if idx < len(trans_nps_diff):
            t_np_data, t_label = trans_nps_diff[idx]
            info1 = _extract_single_np_data(t_np_data, ctx=ctx)
            forms.append({
                "formIndex": 1,
                "label": f"If {trans_name}",
                "name": info1["name"],
                "metaLines": info1["metaLines"],
                "effects": info1["effects"],
            })

        var = {
            "tier": tier,
            "type": "np",
            "rawTitle": header,
            "cleanTitle": "Noble Phantasm",
            "metaLines": forms[0]["metaLines"],
            "effects": [],
            "forms": forms,
        }
        slot_obj["variantsByTier"][tier] = var
        if tier not in slot_obj["tiers"]:
            slot_obj["tiers"].append(tier)

    slot_obj["tiers"].sort()
    slot_obj["maxTier"] = max(slot_obj["tiers"]) if slot_obj["tiers"] else 0
    slot_obj["activeTier"] = slot_obj["maxTier"]
    return [slot_obj]


def np_to_markdown(structured_nps: list) -> list:
    lines = []
    for slot in structured_nps:
        tiers = sorted(slot.get("tiers", [0]))
        for t in tiers:
            var = slot["variantsByTier"].get(t) or slot["variantsByTier"].get(str(t))
            forms = var.get("forms", [])
            if forms:
                lines.append("")
                lines.append(var["rawTitle"])
                for idx, f in enumerate(forms):
                    options = f.get("options", [])
                    if options:
                        for opt_idx, opt in enumerate(options):
                            if idx > 0 or opt_idx > 0:
                                lines.append("")
                            lbl_tag = f"[{f['label']}] [{opt['label']}]"
                            name_tag = f" ({opt['name']})" if opt.get("name") else ""
                            lines.append(f"{lbl_tag}{name_tag}")
                            lines.extend(opt.get("metaLines", []))
                            lines.extend(opt.get("effects", []))
                    else:
                        if idx > 0:
                            lines.append("")
                        f_lbl = f["label"]
                        lbl_tag = f"[{f_lbl}]" if not f_lbl.startswith("[") else f_lbl
                        name_tag = f" ({f['name']})" if f.get("name") else ""
                        lines.append(f"{lbl_tag}{name_tag}")
                        lines.extend(f.get("metaLines", []))
                        lines.extend(f.get("effects", []))
            else:
                lines.append("")
                lines.append(var["rawTitle"])
                lines.extend(var.get("metaLines", []))
                lines.extend(var.get("effects", []))
    return lines


def _fmt_mash_noble_phantasms(nps, svt_id, ctx=None) -> list:
    structured = _fmt_mash_noble_phantasms_structured(nps, svt_id, ctx=ctx)
    return np_to_markdown(structured)


def fmt_np(
    nps,
    svt_id,
    ctx=None,
    transform_nps=None,
    transform_svt_id=None,
) -> list:
    structured = format_np_structured(
        nps,
        svt_id,
        ctx=ctx,
        transform_nps=transform_nps,
        transform_svt_id=transform_svt_id,
    )
    return np_to_markdown(structured)
