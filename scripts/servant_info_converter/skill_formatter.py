import os
import re
from urllib.parse import urlparse

from .effect_map import (
    TARGET_LABELS,
    TRAIT_ID_LABELS,
    BTN_SELECT_IMAGE_MAP,
    SELECT_OPTION_LABELS,
)
from .utils import (
    fmt_condition,
    group_and_label_items,
    is_mash,
    detect_costume_form,
    append_chained_roll_tag,
)
from .context import FetchContext
from .function_formatter import (
    fmt_function,
    fmt_function_stacked,
    fmt_delay_fn,
)


_MEAL_SKILL_CHAIN = {
    2656550: [
        ("1st Time", 2656550),
        ("2nd Time", 2656600),
        ("3rd Time", 2656625),
        ("4th Time", 2656650),
        ("5th Time", 2656675),
        ("6th Time", 2656700),
    ]
}


def _fmt_single_skill_functions(lines, sk, ctx=None):
    functions = sk.get("functions", [])
    if not any(
        (fn.get("buffs") or [{}])[0].get("type", "")
        in (
            "tdTypeChange",
            "tdTypeChangeArts",
            "tdTypeChangeBuster",
            "tdTypeChangeQuick",
        )
        for fn in functions
        if fn.get("buffs")
    ) and any(
        (fn.get("svals") or [{}])[0].get("ActSet") is not None for fn in functions
    ):
        for fn in functions:
            if (fn.get("svals") or [{}])[0].get("ActSet") is None:
                res = fmt_function(fn, ctx=ctx)
                if res:
                    lines.append(res)
        seen_act_sets = []
        for fn in functions:
            aset = (fn.get("svals") or [{}])[0].get("ActSet")
            if aset is not None and aset not in seen_act_sets:
                seen_act_sets.append(aset)
        for aset in seen_act_sets:
            set_fns = [
                fn
                for fn in functions
                if (fn.get("svals") or [{}])[0].get("ActSet") == aset
            ]
            weight = (set_fns[0].get("svals") or [{}])[0].get("ActSetWeight")
            label = f"[{weight}% Chance]" if weight is not None else f"[Set {aset}]"
            lines.append(label)
            for fn in set_fns:
                res = fmt_function(fn, ctx=ctx)
                if res:
                    lines.append(res)
    else:
        has_gain_np_crit_star = any(
            f.get("funcType") == "gainNpCriticalstarSum" for f in functions
        )
        i = 0
        while i < len(functions):
            fn = functions[i]
            if fn.get("funcType") == "lossStar" and has_gain_np_crit_star:
                i += 1
                continue
            buff_type = (
                (fn.get("buffs") or [{}])[0].get("type", "") if fn.get("buffs") else ""
            )
            if buff_type in (
                "tdTypeChange",
                "tdTypeChangeArts",
                "tdTypeChangeBuster",
                "tdTypeChangeQuick",
            ):
                j = i
                td_labels = []
                prefix = ""
                suffix = ""
                while j < len(functions):
                    fn_j = functions[j]
                    bt_j = (
                        (fn_j.get("buffs") or [{}])[0].get("type", "")
                        if fn_j.get("buffs")
                        else ""
                    )
                    if bt_j not in (
                        "tdTypeChange",
                        "tdTypeChangeArts",
                        "tdTypeChangeBuster",
                        "tdTypeChangeQuick",
                    ):
                        break

                    res = fmt_function(fn_j, ctx=ctx)
                    if res:
                        m = re.match(r"(.*Change NP Card type to )\[(.*?)\](.*)", res)
                        if m:
                            pre, label, suf = m.groups()
                            if not prefix:
                                prefix = pre
                            if not suffix:
                                suffix = suf
                            if label not in td_labels:
                                td_labels.append(label)
                        else:
                            break
                    j += 1
                if td_labels:
                    if len(td_labels) > 2:
                        td_types_str = (
                            ", ".join(td_labels[:-1]) + f" or {td_labels[-1]}"
                        )
                    else:
                        td_types_str = " or ".join(td_labels)
                    lines.append(f"{prefix}[{td_types_str}]{suffix}")
                i = j
                continue

            j = i + 1
            func_id = fn.get("funcId")
            sv_i = (fn.get("svals") or [{}])[0]
            hp_i = sv_i.get("TriggeredTargetHpRateRange")
            star_h_i = sv_i.get("StarHigher")
            star_l_i = sv_i.get("StarLower")
            param_i = sv_i.get("ParamAddValue")
            rate_i = sv_i.get("Rate", 1000)

            is_chained = False
            if rate_i > 0 and j < len(functions):
                sv_next = (functions[j].get("svals") or [{}])[0]
                if sv_next.get("Rate", 1000) == -abs(rate_i):
                    is_chained = True

            if is_chained:
                while j < len(functions):
                    fn_j = functions[j]
                    sv_j = (fn_j.get("svals") or [{}])[0]
                    if (
                        sv_j.get("Rate", 1000) != -abs(rate_i)
                        or fn_j.get("funcType") != fn.get("funcType")
                        or fn_j.get("funcTargetType") != fn.get("funcTargetType")
                        or [b.get("id") for b in fn_j.get("buffs", [])]
                        != [b.get("id") for b in fn.get("buffs", [])]
                        or sv_j.get("Value") != sv_i.get("Value")
                        or sv_j.get("Turn") != sv_i.get("Turn")
                        or sv_j.get("Count") != sv_i.get("Count")
                    ):
                        break
                    j += 1
                res = fmt_function(fn, ctx=ctx)
                if res:
                    if j - i > 1:
                        res = append_chained_roll_tag(res, j - i)
                    lines.append(res)
                i = j
                continue

            while j < len(functions):
                fn_j = functions[j]
                sv_j = (fn_j.get("svals") or [{}])[0]
                if (
                    fn_j.get("funcId") != func_id
                    or hp_i != sv_j.get("TriggeredTargetHpRateRange")
                    or star_h_i != sv_j.get("StarHigher")
                    or star_l_i != sv_j.get("StarLower")
                    or param_i != sv_j.get("ParamAddValue")
                ):
                    break
                j += 1
            res = (
                fmt_function_stacked(fn, j - i, ctx=ctx)
                if j - i > 1
                else fmt_function(fn, ctx=ctx)
            )
            if res:
                lines.append(res)
            i = j


def _fmt_skill_functions_to_lines(lines, sk, ctx=None):
    functions = sk.get("functions", [])
    if ctx is None:
        ctx = FetchContext(functions=functions)
    else:
        ctx.functions = functions

    script = sk.get("script", {})
    np_higher = script.get("NP_HIGHER")
    if np_higher:
        val_str = (
            f"{np_higher[0]}%"
            if np_higher[0] == np_higher[-1]
            else f"{np_higher[0]}-{np_higher[-1]}%"
        )
        lines.append(f"[Usable only when your NP Gauge is {val_str} or higher]")

    star_higher = script.get("STAR_HIGHER")
    if star_higher:
        lines.append(
            f"[Usable only when there are more than {star_higher[0]} Critical Stars]"
        )

    np_lower = script.get("NP_LOWER")
    if np_lower:
        val_str = (
            f"{np_lower[0]}%"
            if np_lower[0] == np_lower[-1]
            else f"{np_lower[0]}-{np_lower[-1]}%"
        )
        lines.append(f"[Usable only when your NP Gauge is {val_str} or lower]")

    if sk.get("id") in _MEAL_SKILL_CHAIN:
        for _idx, (time_label, skill_id) in enumerate(_MEAL_SKILL_CHAIN[sk.get("id")]):
            lines.append(f"[{time_label}]")
            cur_sk = (
                sk
                if skill_id == sk.get("id")
                else (
                    ctx.fetch_inner_skill(skill_id)
                    if ctx and ctx.fetch_inner_skill
                    else None
                )
            )
            if cur_sk:
                _fmt_single_skill_functions(lines, cur_sk, ctx=ctx)
        return

    cond_branches = sk.get("script", {}).get("condBranchSkillInfo", [])
    if cond_branches:
        for branch in cond_branches:
            inner_id = branch.get("skillId")
            cond_vals = branch.get("condValue", [])
            is_self = 1 in cond_vals or True in cond_vals
            branch_label = (
                "[When targeting self]" if is_self else "[When targeting another Ally]"
            )
            lines.append(branch_label)
            inner_sk = (
                ctx.fetch_inner_skill(inner_id)
                if ctx and ctx.fetch_inner_skill
                else None
            )
            if inner_sk:
                _fmt_single_skill_functions(lines, inner_sk, ctx=ctx)
    elif any(
        (fn.get("svals") or [{}])[0].get("ActSelectIndex") is not None
        for fn in functions
    ):
        max_idx = max(
            (fn.get("svals") or [{}])[0].get("ActSelectIndex", -1) for fn in functions
        )
        select_add_info = sk.get("script", {}).get("SelectAddInfo")
        btn_list = select_add_info[0].get("btn", []) if select_add_info else []
        btn_labels = []
        for idx, b in enumerate(btn_list):
            raw_lbl = b.get("name") or BTN_SELECT_IMAGE_MAP.get(b.get("image", "")) or f"Option {idx + 1}"
            lbl = SELECT_OPTION_LABELS.get(raw_lbl, raw_lbl)
            m_star = re.match(r"^(\d+)個消費する$", lbl)
            if m_star:
                lbl = f"Expend {m_star.group(1)} Critical Stars"
            btn_labels.append(lbl)

        if btn_labels and len(btn_labels) >= 2:
            opt_names = " / ".join(f"[{lbl}]" for lbl in btn_labels)
            lines.append(f"Select {max_idx + 1} Options ({opt_names})")
        else:
            lines.append(f"Select {max_idx + 1} Options")

        for fn in functions:
            ai = (fn.get("svals") or [{}])[0].get("ActSelectIndex")
            if ai is not None:
                if btn_labels and ai < len(btn_labels):
                    opt_label = f"[{btn_labels[ai]}]"
                else:
                    opt_label = f"[Option {ai + 1}]"
            else:
                opt_label = ""
            res = (
                fmt_delay_fn(fn, ctx=ctx)
                if fn.get("buffs", []) and fn["buffs"][0]["type"] == "delayFunction"
                else fmt_function(fn, ctx=ctx)
            )
            if res:
                lines.append(f"{opt_label} {res}" if opt_label else res)
    else:
        _fmt_single_skill_functions(lines, sk, ctx=ctx)


def _get_tier_from_title(title: str) -> int:
    m = re.search(r"\[(\d+)(?:st|nd|rd|th)\s+Strengthen\]", title, re.IGNORECASE)
    if m:
        return int(m.group(1))
    if "[Strengthen]" in title or "Strengthen]" in title:
        return 1
    return 0


def _skill_icon_path(sk) -> str:
    raw = sk.get("icon") if isinstance(sk, dict) else sk
    if not isinstance(raw, str) or not raw.strip():
        return ""
    raw = raw.strip()
    if raw.startswith("skill_icons/") and raw.endswith(".webp") and "://" not in raw:
        return raw
    base = os.path.basename(urlparse(raw).path)
    stem = os.path.splitext(base)[0]
    return f"skill_icons/{stem}.webp" if stem else ""


def _fmt_mash_skills_structured(skills, svt_id, ctx=None) -> list:
    forms = ["All Ascensions", "Spiritron Dress: Ortinax", "Spiritron Dress: Paladin"]
    slots = []

    rankup_map = {}
    if ctx and ctx.svt_data:
        rankup_map = ctx.svt_data.get("script", {}).get("SkillRankUp", {})

    for slot in (1, 2, 3):
        slot_skills = [sk for sk in skills if sk.get("num") == slot]
        by_form = {f: [] for f in forms}
        for sk in slot_skills:
            sk_form = "All Ascensions"
            for s in sk.get("skillSvts", []):
                f = detect_costume_form(s.get("releaseConditions", []))
                if f != "All Ascensions":
                    sk_form = f
                    break
            by_form[sk_form].append(sk)

        form_tiers = {f: [] for f in forms}
        for f in forms:
            f_sks = sorted(
                by_form[f],
                key=lambda x: (x.get("strengthStatus", 0), x.get("priority", 0), x.get("id")),
            )
            unique_f_sks = []
            seen_names = set()
            for sk in f_sks:
                sk_name = sk.get("name")
                if sk_name not in seen_names:
                    seen_names.add(sk_name)
                    unique_f_sks.append(sk)
                elif rankup_map and str(sk.get("id")) in rankup_map:
                    unique_f_sks = [sk if x.get("name") == sk_name else x for x in unique_f_sks]
            form_tiers[f] = unique_f_sks

        slot_obj = {
            "slotKey": f"skill_{slot}",
            "type": "skill",
            "slotNum": slot,
            "variantsByTier": {},
            "tiers": [],
            "maxTier": 0,
            "activeTier": 0,
        }

        forms_list = []
        for f_idx, f in enumerate(forms):
            sks = form_tiers[f]
            if not sks:
                continue
            base_sk = sks[0]
            base_name = base_sk.get("name", "")
            cd = base_sk.get("coolDown") or [0]
            cd_str = f"Cooldown {f'{cd[0]}-{cd[-1]}' if cd[0] != cd[-1] else str(cd[0])} turns"

            inner_sk_id = None
            if rankup_map and str(base_sk.get("id")) in rankup_map:
                targets = rankup_map[str(base_sk.get("id"))]
                if targets:
                    inner_sk_id = targets[0]

            inner_sk = (
                ctx.fetch_inner_skill(inner_sk_id)
                if inner_sk_id and ctx and ctx.fetch_inner_skill
                else None
            )
            icon_path = _skill_icon_path(base_sk)
            if inner_sk:
                opt1_lines = []
                _fmt_skill_functions_to_lines(opt1_lines, base_sk, ctx=ctx)
                effects_lines = [f"[Normal] {l}" for l in opt1_lines]
                opt2_lines = []
                _fmt_skill_functions_to_lines(opt2_lines, inner_sk, ctx=ctx)
                effects_lines.extend([f"[When loaded with the Holy Sword] {l}" for l in opt2_lines])
                form_entry = {
                    "formIndex": f_idx,
                    "label": f,
                    "name": base_name,
                    "cooldown": cd_str,
                    "effects": effects_lines,
                }
                if icon_path:
                    form_entry["icon"] = icon_path
                forms_list.append(form_entry)
            else:
                fx_lines = []
                _fmt_skill_functions_to_lines(fx_lines, base_sk, ctx=ctx)
                form_entry = {
                    "formIndex": f_idx,
                    "label": f,
                    "name": base_name,
                    "cooldown": cd_str,
                    "effects": fx_lines,
                }
                if icon_path:
                    form_entry["icon"] = icon_path
                forms_list.append(form_entry)

        var0 = {
            "tier": 0,
            "type": "skill",
            "rawTitle": f"Skill {slot}",
            "cleanTitle": f"Skill {slot}",
            "cooldown": forms_list[0]["cooldown"] if forms_list else "",
            "effects": [],
            "forms": forms_list,
        }
        if forms_list and forms_list[0].get("icon"):
            var0["icon"] = forms_list[0]["icon"]
        slot_obj["variantsByTier"][0] = var0
        slot_obj["tiers"].append(0)

        has_tier1 = any(len(form_tiers[f]) > 1 for f in forms)
        if has_tier1:
            tier1_forms = []
            for f_idx, f in enumerate(forms):
                sks = form_tiers[f]
                if len(sks) > 1:
                    st_sk = sks[1]
                    st_name = st_sk.get("name", "")
                    cd = st_sk.get("coolDown") or [0]
                    cd_str = f"Cooldown {f'{cd[0]}-{cd[-1]}' if cd[0] != cd[-1] else str(cd[0])} turns"
                    fx_lines = []
                    _fmt_skill_functions_to_lines(fx_lines, st_sk, ctx=ctx)
                    form_entry = {
                        "formIndex": f_idx,
                        "label": f,
                        "name": st_name,
                        "cooldown": cd_str,
                        "effects": fx_lines,
                    }
                    icon_path = _skill_icon_path(st_sk)
                    if icon_path:
                        form_entry["icon"] = icon_path
                    tier1_forms.append(form_entry)
            var1 = {
                "tier": 1,
                "type": "skill",
                "rawTitle": f"Skill {slot} [Strengthen]",
                "cleanTitle": f"Skill {slot}",
                "cooldown": tier1_forms[0]["cooldown"] if tier1_forms else "",
                "effects": [],
                "forms": tier1_forms,
            }
            if tier1_forms and tier1_forms[0].get("icon"):
                var1["icon"] = tier1_forms[0]["icon"]
            slot_obj["variantsByTier"][1] = var1
            slot_obj["tiers"].append(1)

        has_tier2 = any(len(form_tiers[f]) > 2 for f in forms)
        if has_tier2:
            tier2_forms = []
            for f_idx, f in enumerate(forms):
                sks = form_tiers[f]
                if len(sks) > 2:
                    st_sk = sks[2]
                    st_name = st_sk.get("name", "")
                    cd = st_sk.get("coolDown") or [0]
                    cd_str = f"Cooldown {f'{cd[0]}-{cd[-1]}' if cd[0] != cd[-1] else str(cd[0])} turns"
                    fx_lines = []
                    _fmt_skill_functions_to_lines(fx_lines, st_sk, ctx=ctx)
                    form_entry = {
                        "formIndex": f_idx,
                        "label": f,
                        "name": st_name,
                        "cooldown": cd_str,
                        "effects": fx_lines,
                    }
                    icon_path = _skill_icon_path(st_sk)
                    if icon_path:
                        form_entry["icon"] = icon_path
                    tier2_forms.append(form_entry)
            var2 = {
                "tier": 2,
                "type": "skill",
                "rawTitle": f"Skill {slot} [2nd Strengthen]",
                "cleanTitle": f"Skill {slot}",
                "cooldown": tier2_forms[0]["cooldown"] if tier2_forms else "",
                "effects": [],
                "forms": tier2_forms,
            }
            if tier2_forms and tier2_forms[0].get("icon"):
                var2["icon"] = tier2_forms[0]["icon"]
            slot_obj["variantsByTier"][2] = var2
            slot_obj["tiers"].append(2)

        slot_obj["maxTier"] = max(slot_obj["tiers"])
        slot_obj["activeTier"] = slot_obj["maxTier"]
        slots.append(slot_obj)

    return slots


def format_skills_structured(
    skills,
    svt_id,
    ctx=None,
    transform_skills=None,
    transform_svt_id=None,
) -> list:
    if is_mash(svt_id):
        return _fmt_mash_skills_structured(skills, svt_id, ctx=ctx)

    items = group_and_label_items(skills, svt_id, "Skill", svt_key="skillSvts")

    sub_groups = []
    curr_group = []
    curr_key = None
    for sk, label in items:
        key = (sk.get("num", 1), sk.get("strengthStatus", 0))
        if curr_key is not None and key != curr_key:
            sub_groups.append((curr_key, curr_group))
            curr_group = []
        curr_key = key
        curr_group.append((sk, label))
    if curr_group:
        sub_groups.append((curr_key, curr_group))

    trans_map_by_num_quest = {}
    trans_map_by_num_prio = {}
    trans_map_by_num_ss = {}
    trans_map_by_num_name = {}
    trans_map_by_num = {}
    if transform_skills:
        for t_sk in sorted(
            transform_skills,
            key=lambda x: (x.get("priority", 0), x.get("id", 0)),
        ):
            num = t_sk.get("num", 1)
            cond_quest = t_sk.get("condQuestId", 0)
            if cond_quest:
                trans_map_by_num_quest.setdefault((num, cond_quest), t_sk)
            prio = t_sk.get("priority")
            if prio is not None:
                trans_map_by_num_prio.setdefault((num, prio), t_sk)
            t_ss = t_sk.get("strengthStatus")
            if t_ss is not None:
                trans_map_by_num_ss.setdefault((num, t_ss), t_sk)
            name = t_sk.get("name", "")
            trans_map_by_num_name.setdefault((num, name), t_sk)
            trans_map_by_num.setdefault(num, t_sk)

    slots_by_num = {}

    for (num, ss), grp in sub_groups:
        slot_key = f"skill_{num}"
        if slot_key not in slots_by_num:
            slots_by_num[slot_key] = {
                "slotKey": slot_key,
                "type": "skill",
                "slotNum": num,
                "variantsByTier": {},
                "tiers": [],
                "maxTier": 0,
                "activeTier": 0,
            }
        slot_obj = slots_by_num[slot_key]

        sk0, label0 = grp[0]
        cond_quest0 = sk0.get("condQuestId", 0)
        prio0 = sk0.get("priority")
        trans_sk = (
            (trans_map_by_num_quest.get((num, cond_quest0)) if cond_quest0 else None)
            or (trans_map_by_num_prio.get((num, prio0)) if prio0 is not None else None)
            or trans_map_by_num_ss.get((num, ss))
            or trans_map_by_num_name.get((num, sk0.get("name", "")))
            or trans_map_by_num.get(num)
        )

        # Case A: Transformed servant skills (different servant ID)
        if trans_sk and trans_sk.get("id") != sk0.get("id"):
            main_name = TRAIT_ID_LABELS.get(svt_id, "Form 1")
            trans_name = TRAIT_ID_LABELS.get(transform_svt_id, "Form 2")

            tag = label0[label0.find("[") :] if "[" in label0 else ""
            header = f"Skill {num}{' ' if tag else ''}{tag}"
            tier = _get_tier_from_title(header)

            cd0 = sk0.get("coolDown") or [0]
            cd_str0 = f"Cooldown {f'{cd0[0]}-{cd0[-1]}' if cd0[0] != cd0[-1] else str(cd0[0])} turns"
            fx0 = []
            _fmt_skill_functions_to_lines(fx0, sk0, ctx=ctx)

            trans_cd = trans_sk.get("coolDown") or [0]
            cd_str1 = f"Cooldown {f'{trans_cd[0]}-{trans_cd[-1]}' if trans_cd[0] != trans_cd[-1] else str(trans_cd[0])} turns"
            fx1 = []
            _fmt_skill_functions_to_lines(fx1, trans_sk, ctx=ctx)

            icon0 = _skill_icon_path(sk0)
            icon1 = _skill_icon_path(trans_sk)
            form0 = {
                "formIndex": 0,
                "label": f"If {main_name}",
                "name": sk0.get("name", ""),
                "cooldown": cd_str0,
                "effects": fx0,
            }
            if icon0:
                form0["icon"] = icon0
            form1 = {
                "formIndex": 1,
                "label": f"If {trans_name}",
                "name": trans_sk.get("name", ""),
                "cooldown": cd_str1,
                "effects": fx1,
            }
            if icon1:
                form1["icon"] = icon1
            forms = [form0, form1]

            variant = {
                "tier": tier,
                "type": "skill",
                "rawTitle": header,
                "cleanTitle": f"Skill {num}",
                "cooldown": cd_str0,
                "effects": [],
                "forms": forms,
            }
            if icon0 or icon1:
                variant["icon"] = icon0 or icon1
            slot_obj["variantsByTier"][tier] = variant
            if tier not in slot_obj["tiers"]:
                slot_obj["tiers"].append(tier)

        # Case B: Multiple ascension variant items for the same skill slot
        elif len(grp) > 1:
            tag = ""
            if " [Strengthen]" in label0:
                tag = " [Strengthen]"
            elif " Strengthen]" in label0:
                m = re.search(r"(\[\d+.*?Strengthen\])", label0)
                if m:
                    tag = f" {m.group(1)}"
            header = f"Skill {num}{tag}"
            tier = _get_tier_from_title(header)

            forms = []
            for idx, (sk, label) in enumerate(grp):
                asc_match = re.search(r"\[(.* Ascension)\]", label)
                asc_str = (
                    f"[{asc_match.group(1)}]" if asc_match else f"[Form {idx+1}]"
                )
                cd = sk.get("coolDown") or [0]
                cd_str = f"Cooldown {f'{cd[0]}-{cd[-1]}' if cd[0] != cd[-1] else str(cd[0])} turns"
                fx = []
                _fmt_skill_functions_to_lines(fx, sk, ctx=ctx)
                form_entry = {
                    "formIndex": idx,
                    "label": asc_str.replace("[", "").replace("]", "").strip(),
                    "name": sk.get("name", ""),
                    "cooldown": cd_str,
                    "effects": fx,
                }
                icon_path = _skill_icon_path(sk)
                if icon_path:
                    form_entry["icon"] = icon_path
                forms.append(form_entry)

            variant = {
                "tier": tier,
                "type": "skill",
                "rawTitle": header,
                "cleanTitle": f"Skill {num}",
                "cooldown": forms[0]["cooldown"] if forms else "",
                "effects": [],
                "forms": forms,
            }
            if forms and forms[0].get("icon"):
                variant["icon"] = forms[0]["icon"]
            slot_obj["variantsByTier"][tier] = variant
            if tier not in slot_obj["tiers"]:
                slot_obj["tiers"].append(tier)

        # Case C: Standard single skill
        else:
            sk, label = grp[0]
            tier = _get_tier_from_title(label)
            cd = sk.get("coolDown") or [0]
            cd_str = f"Cooldown {f'{cd[0]}-{cd[-1]}' if cd[0] != cd[-1] else str(cd[0])} turns"
            fx = []
            _fmt_skill_functions_to_lines(fx, sk, ctx=ctx)
            sk_name = (sk.get("name") or "").strip()
            clean_title = f"Skill {num} ({sk_name})" if sk_name else f"Skill {num}"

            variant = {
                "tier": tier,
                "type": "skill",
                "rawTitle": label,
                "cleanTitle": clean_title,
                "cooldown": cd_str,
                "effects": fx,
                "forms": [],
            }
            icon_path = _skill_icon_path(sk)
            if icon_path:
                variant["icon"] = icon_path
            slot_obj["variantsByTier"][tier] = variant
            if tier not in slot_obj["tiers"]:
                slot_obj["tiers"].append(tier)

    slots = []
    for slot_key in sorted(slots_by_num.keys()):
        slot_obj = slots_by_num[slot_key]
        slot_obj["tiers"].sort()
        slot_obj["maxTier"] = max(slot_obj["tiers"]) if slot_obj["tiers"] else 0
        slot_obj["activeTier"] = slot_obj["maxTier"]
        slots.append(slot_obj)

    return slots


def skills_to_markdown(structured_skills: list) -> list:
    lines = []
    for slot in structured_skills:
        tiers = sorted(slot.get("tiers", [0]))
        for t in tiers:
            var = slot["variantsByTier"].get(t) or slot["variantsByTier"].get(str(t))
            lines.append("")
            lines.append(var["rawTitle"])
            forms = var.get("forms", [])
            if forms:
                for idx, f in enumerate(forms):
                    if idx > 0:
                        lines.append("")
                    f_lbl = f["label"]
                    lbl_tag = f"[{f_lbl}]" if not f_lbl.startswith("[") else f_lbl
                    f_name = f.get("name", "")
                    name_tag = f" ({f_name})" if f_name else ""
                    lines.append(f"{lbl_tag}{name_tag}")
                    if f.get("cooldown"):
                        lines.append(f["cooldown"])
                    lines.extend(f.get("effects", []))
            else:
                if var.get("cooldown"):
                    lines.append(var["cooldown"])
                lines.extend(var.get("effects", []))
    return lines


def _fmt_mash_skills(skills, svt_id, ctx=None) -> list:
    structured = _fmt_mash_skills_structured(skills, svt_id, ctx=ctx)
    return skills_to_markdown(structured)


def fmt_skills(
    skills,
    svt_id,
    ctx=None,
    transform_skills=None,
    transform_svt_id=None,
) -> list:
    structured = format_skills_structured(
        skills,
        svt_id,
        ctx=ctx,
        transform_skills=transform_skills,
        transform_svt_id=transform_svt_id,
    )
    return skills_to_markdown(structured)


def _fmt_passive_skill_list(passives, ctx=None) -> list:
    lines = []
    seen_lines = set()
    for sk in passives:
        sk_fns = sk.get("functions", [])
        k = 0
        while k < len(sk_fns):
            fn = sk_fns[k]
            bufs = fn.get("buffs", [])
            if bufs and bufs[0]["type"] == "guts":
                sv0 = (fn.get("svals") or [{}])[0]
                val_str = f" by {sv0.get('Value', '')}" if sv0.get("Value") else ""
                cond = fmt_condition(sv0.get("Turn", -1), sv0.get("Count", -1))
                line = f"Apply Guts{val_str}{' ' + cond if cond else ''}"
                if k + 1 < len(sk_fns):
                    nb = sk_fns[k + 1].get("buffs", [])
                    if nb and nb[0]["type"] == "guts" and not nb[0].get("ckOpIndv"):
                        inner_id = (sk_fns[k + 1].get("svals") or [{}])[0].get("Value")
                        hp_val_str = ""
                        if inner_id:
                            _inner_sk = (
                                ctx.fetch_inner_skill(inner_id)
                                if ctx and ctx.fetch_inner_skill
                                else None
                            )
                            for ifn in (_inner_sk or {}).get("functions", []):
                                if ifn.get("funcType") in ("gainHp", "addHp"):
                                    hp_val_str = f" by {(ifn.get('svals') or [{}])[0].get('Value', '')}"
                                    break
                        line += f' & a state that "restores HP{hp_val_str} when Guts is activated"'
                        k += 1
                full_line = f"{line} {TARGET_LABELS.get(fn.get('funcTargetType', ''), fn.get('funcTargetType', ''))}".strip()
                if full_line not in seen_lines:
                    seen_lines.add(full_line)
                    lines.append(full_line)
            else:
                res = fmt_function(fn, ctx=ctx)
                if res and res not in seen_lines:
                    seen_lines.add(res)
                    lines.append(res)
            k += 1
    return lines


def format_passives_structured(
    data,
    ctx=None,
    transform_passives=None,
    transform_svt_id=None,
) -> list:
    if isinstance(data, dict):
        base_passives = data.get("classPassive", [])
    else:
        base_passives = data

    base_lines = _fmt_passive_skill_list(base_passives, ctx=ctx)

    trans_lines = []
    if transform_passives:
        trans_lines = _fmt_passive_skill_list(transform_passives, ctx=ctx)

    if trans_lines and trans_lines != base_lines:
        svt_id = data.get("id") if isinstance(data, dict) else None
        main_name = TRAIT_ID_LABELS.get(svt_id, "Form 1")
        trans_name = TRAIT_ID_LABELS.get(transform_svt_id, "Form 2")
        forms = [
            {
                "formIndex": 0,
                "label": f"If {main_name}",
                "effects": base_lines,
            },
            {
                "formIndex": 1,
                "label": f"If {trans_name}",
                "effects": trans_lines,
            },
        ]
        variant = {
            "tier": 0,
            "type": "passive",
            "rawTitle": "Passives",
            "cleanTitle": "Passives",
            "effects": [],
            "forms": forms,
        }
    else:
        variant = {
            "tier": 0,
            "type": "passive",
            "rawTitle": "Passives",
            "cleanTitle": "Passives",
            "effects": base_lines,
            "forms": [],
        }

    slot_obj = {
        "slotKey": "passive_1",
        "type": "passive",
        "variantsByTier": {0: variant},
        "tiers": [0],
        "maxTier": 0,
        "activeTier": 0,
    }
    return [slot_obj]


def passives_to_markdown(structured_passives: list) -> list:
    lines = []
    for slot in structured_passives:
        var = slot["variantsByTier"].get(0) or slot["variantsByTier"].get("0")
        lines.append("")
        lines.append(var["rawTitle"])
        forms = var.get("forms", [])
        if forms:
            for idx, f in enumerate(forms):
                if idx > 0:
                    lines.append("")
                f_lbl = f["label"]
                lbl_tag = f"[{f_lbl}]" if not f_lbl.startswith("[") else f_lbl
                lines.append(lbl_tag)
                lines.extend(f.get("effects", []))
        else:
            lines.extend(var.get("effects", []))
    return lines


def fmt_passives(
    data,
    ctx=None,
    transform_passives=None,
    transform_svt_id=None,
) -> list:
    structured = format_passives_structured(
        data,
        ctx=ctx,
        transform_passives=transform_passives,
        transform_svt_id=transform_svt_id,
    )
    return passives_to_markdown(structured)
