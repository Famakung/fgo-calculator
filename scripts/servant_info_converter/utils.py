from .effect_map import TRAIT_ID_LABELS, NEGATIVE_TRAIT_LABELS

TRIGGER_INFO = {
    "attackBeforeFunction": ("attacking", "before damage", False),
    "attackBeforeFunctionMainOnly": ("attacking", "before damage", False),
    "attackAfterFunction": ("attacking", "after damage", False),
    "attackAfterFunctionMainOnly": ("attacking", "after damage", False),
    "damageFunction": ("damaged", "", False),
    "gutsFunction": ("Guts is activated", "", False),
    "commandattackBeforeFunction": ("attacking", "before damage", True),
    "commandattackBeforeFunctionMainOnly": ("attacking", "before damage", True),
    "commandattackAfterFunction": ("attacking", "after damage", True),
    "commandattackAfterFunctionMainOnly": ("attacking", "after damage", True),
    "lastSelfturnprogressFunction": ("at the end of last turn", "", False),
    "selfturnendFunction": ("each turn at turn end", "", False),
    "selfturnstartFunction": ("each turn at turn start", "", False),
    "entryFunction": ("entering the field", "", False),
    "continueFunction": ("battle continues", "", False),
    "treasureDeviceAfterFunction": ("using NP", "", False),
    "treasureDeviceBeforeFunction": ("using NP", "", False),
    "npattackPrevBuff": ("attacking with NP", "before damage", False),
}

AILMENT_IGNORE = {
    2729,
    3005,
    3010,
    2191,
    3045,
    3063,
    3004,
    3006,
    3007,
    3008,
    3009,
    3092,
    3093,
    3094,
    3095,
    3096,
    3100,
    3139,
    3140,
    3024,
    3064,
}

INDIVIDUALITIE_IGNORE = {
    3086,  # gutsBlock
    3057,  # buffChangeField
    3079,  # unknown field category
    3024,  # Guts
    3021,  # Evade
    3064,  # Anti-Enforcement DEF
    2920,
    2921,
    2922,
    2923,
}

FIELD_TRAITS = {
    2038,  # Sunlight
    2039,  # Near Water
    2073,  # Forest
    2121,  # Burning
    2392,  # City
    2730,  # Void Space
    2829,  # Millennium Castle
    2878,  # Mid-Air
}

CARD_MAP = {
    "1": "A",
    "2": "B",
    "3": "Q",
    "arts": "A",
    "buster": "B",
    "quick": "Q",
}
CARD_NAMES = {
    "1": "Arts",
    "2": "Buster",
    "3": "Quick",
    "4": "Extra",
    "arts": "Arts",
    "buster": "Buster",
    "quick": "Quick",
    "extra": "Extra",
}
ASC_ORD = {"1": "1st", "2": "2nd", "3": "3rd", "4": "4th"}
STRENGTH_ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"]
NP_GAIN_CARD_KEY = {
    "1": "arts",
    "2": "buster",
    "3": "quick",
    "arts": "arts",
    "buster": "buster",
    "quick": "quick",
}

ATTR_LABELS = {
    "human": "Human",
    "sky": "Heaven",
    "earth": "Earth",
    "star": "Star",
    "beast": "Beast",
    "void": "Void",
    "unknown": "Unknown",
}


def get_card_prefix(buff):
    traits = buff.get("ckSelfIndv", []) or buff.get("ckOpIndv", [])
    trait_ids = {indv.get("id") for indv in traits}
    labels = []
    for indv in traits:
        tid = indv["id"]
        if tid in (3139, 4008):
            continue
        if tid == 3018 and {3021, 3022}.issubset(trait_ids):
            continue
        label = TRAIT_ID_LABELS.get(tid, fmt_trait_name(indv))
        if label:
            s_label = str(label)
            if s_label not in labels:
                labels.append(s_label)
    if not labels:
        return ""
    return " or ".join(labels) + " "


def apply_card_prefix(buff_type, template, card_prefix):
    if not card_prefix or buff_type in (
        "overwriteSvtCardType",
        "buffConvert",
        "avoidFunctionExecuteSelf",
        "upHate",
        "preventDeathByDamage",
        "upToleranceSubstate",
    ):
        return template
    clean_prefix = card_prefix.strip()
    is_card = clean_prefix in ("Arts", "Buster", "Quick", "Extra")
    if buff_type == "upCriticaldamage":
        if is_card:
            return template.replace("Critical", f"{clean_prefix} Card Critical")
        return f"Increase Critical Strength against [{clean_prefix}] enemies by {{val}}"
    if "Card " in template:
        return template.replace("Card ", f"{clean_prefix} Card ")
    if is_card and "Critical" in template:
        return template.replace("Critical", f"{clean_prefix} Card Critical")
    if not is_card and " by {val}" in template:
        effect = template.split(" by {val}")[0]
        if clean_prefix.lower() in effect.lower():
            return template
        aliases = {
            "Burn": ["Spreading Fire"],
            "Poison": ["Corroding Poison"],
            "Curse": ["Disastrous Curse"],
        }
        if clean_prefix in aliases:
            for alt in aliases[clean_prefix]:
                if alt in effect:
                    return template
        return f"{effect} [{clean_prefix}] by {{val}}"
    if clean_prefix.lower() in template.lower():
        return template
    return f"{clean_prefix} {template}"


def is_demerit(fn):
    target = fn.get("funcTargetType", "")
    team = fn.get("funcTargetTeam", "")
    # If the function itself targets the enemy team, it's not a demerit for the player.
    if target in ("enemy", "enemyOne", "enemyAll") or team == "enemy":
        return False
    if (fn.get("svals") or [{}])[0].get("FieldBuffApplyTarget") == 2:
        return False
    # Check for specific demerit buff (id 3005) or demerit func types
    for b in fn.get("buffs", []):
        if any(v.get("id") == 3005 for v in b.get("vals", [])):
            return True
    if fn.get("funcType") in (
        "lossHp",
        "lossHpSafe",
        "lossNp",
        "lossStar",
        "forceInstantDeath",
    ):
        return True
    return False


def fmt_quest_field_target(fn, target):
    quest_fields = fn.get("funcquestTvals", [])
    if not quest_fields:
        return target
    labels = [f"[{fmt_trait_name(t)}]" for t in quest_fields]
    if len(labels) > 2:
        joined = ", ".join(labels[:-1]) + f" or {labels[-1]}"
    else:
        joined = " or ".join(labels)
    return f"only when on a {joined} field {target}"


def apply_tvals_target(target, tvals):
    if target in ("for yourself", "yourself"):
        return target

    tval_ids = {t.get("id") for t in tvals}
    trait_labels = []
    for t in tvals:
        tid = t.get("id")
        if tid == 3139:
            continue
        if tid in (2018, 2040) and (tval_ids & {1002, 1119, 2000}):
            continue
        name = "Genderless" if tid == 3 else fmt_trait_name(t)
        if t.get("negative") and tid in NEGATIVE_TRAIT_LABELS:
            label = NEGATIVE_TRAIT_LABELS[tid]
        else:
            label = f"not {name}" if t.get("negative") else name
        if label not in trait_labels:
            trait_labels.append(label)

    if not trait_labels:
        return target

    # Join multiple traits with "with" and wrap in a single set of brackets
    if len(trait_labels) > 1:
        tval_str = f"[{' with '.join(trait_labels)}]"
    else:
        tval_str = f"[{trait_labels[0]}]"
    for pattern, replacement in [
        ("all allies", f"all {tval_str} allies"),
        ("all enemies", f"all {tval_str} enemies"),
        ("a single ally", f"a single {tval_str} ally"),
        ("one enemy", f"one {tval_str} enemy"),
        ("a single enemy", f"a single {tval_str} enemy"),
    ]:
        if pattern in target:
            return target.replace(pattern, replacement, 1)
    return f"{target} {tval_str}"


def fmt_trait_name(trait):
    if not isinstance(trait, dict):
        tid = trait
        if tid in TRAIT_ID_LABELS:
            return TRAIT_ID_LABELS[tid]
        return f"{tid}:Unknown"
    tid = trait.get("id")
    if tid in TRAIT_ID_LABELS:
        return TRAIT_ID_LABELS[tid]
    name = trait.get("name", "Unknown")
    if not name or name == "unknown":
        name = "Unknown"
    return f"{tid}:{name}"


def fmt_asc_ordinal(ascs):
    return "&".join(ASC_ORD.get(str(a), f"{a}th") for a in sorted(ascs)) + " Ascension"


def fmt_attribute(data):
    base_key = data.get("attribute", "")
    base = ATTR_LABELS.get(base_key, base_key.capitalize())
    asc_map = data.get("ascensionAdd", {}).get("attribute", {}).get("ascension", {})
    if not asc_map:
        return base

    all_vals = {}
    for asc_num in (0, 1, 2, 3, 4):
        attr_val = asc_map.get(str(asc_num))
        all_vals[asc_num] = ATTR_LABELS.get(attr_val, attr_val.capitalize()) if attr_val else base

    if len(set(all_vals.values())) == 1:
        return base

    grouped = {}
    for asc_num, label in sorted(all_vals.items()):
        grouped.setdefault(label, []).append(_ASC_DISPLAY[asc_num])

    parts = []
    for label, ascs in sorted(grouped.items(), key=lambda x: min(x[1])):
        asc_label = fmt_asc_ordinal(sorted(set(ascs)))
        parts.append(f"{label}({asc_label})")
    return ", ".join(parts)


def get_ascension_profile_variants(data):
    """Detect if a servant has differing traits (attribute, alignment, gender) across ascensions."""
    base_attr_key = data.get("attribute", "")
    base_attr = ATTR_LABELS.get(base_attr_key, base_attr_key.capitalize())
    asc_attr_map = data.get("ascensionAdd", {}).get("attribute", {}).get("ascension", {})

    attrs = {}
    for a in (0, 1, 2, 3, 4):
        raw = asc_attr_map.get(str(a))
        attrs[a] = ATTR_LABELS.get(raw, raw.capitalize()) if raw else base_attr

    indv_map = data.get("ascensionAdd", {}).get("individuality", {}).get("ascension", {})
    base_align = [t for t in data.get("traits", []) if t.get("name", "").startswith("alignment")]
    base_gender = [t for t in data.get("traits", []) if t.get("name", "").startswith("gender")]

    aligns = {}
    genders = {}
    for a in (0, 1, 2, 3, 4):
        t_list = indv_map.get(str(a), [])
        m_align = [t for t in t_list if t.get("name", "").startswith("alignment")]
        aligns[a] = tuple(sorted(t["id"] for t in (m_align or base_align)))
        m_gender = [t for t in t_list if t.get("name", "").startswith("gender")]
        genders[a] = tuple(sorted(t["id"] for t in (m_gender or base_gender)))

    has_diff = (
        len(set(attrs.values())) > 1
        or len(set(aligns.values())) > 1
        or len(set(genders.values())) > 1
    )
    if not has_diff:
        return None

    groups = {}
    for a in (0, 1, 2, 3, 4):
        key = (attrs[a], aligns[a], genders[a])
        disp = _ASC_DISPLAY[a]
        groups.setdefault(key, []).append(disp)

    result = []
    for (attr, align_ids, gender_ids), disp_list in sorted(
        groups.items(), key=lambda item: min(item[1])
    ):
        asc_tag = fmt_asc_ordinal(sorted(set(disp_list)))

        align_traits = [t for t in data.get("traits", []) if t["id"] in align_ids]
        if not align_traits and indv_map:
            for t_list in indv_map.values():
                align_traits = [t for t in t_list if t["id"] in align_ids]
                if align_traits:
                    break
        align_label = _join_trait_labels(align_traits, TRAIT_ID_LABELS)

        gender_traits = [t for t in data.get("traits", []) if t["id"] in gender_ids]
        if not gender_traits and indv_map:
            for t_list in indv_map.values():
                gender_traits = [t for t in t_list if t["id"] in gender_ids]
                if gender_traits:
                    break
        gender_label = _join_trait_labels(gender_traits, TRAIT_ID_LABELS)

        result.append({
            "tag": asc_tag,
            "attribute": attr,
            "alignment": align_label,
            "gender": gender_label,
        })
    return result


def fmt_attribute_blocks(data):
    """Format Sub-Attribute line(s)."""
    base_key = data.get("attribute", "")
    base = ATTR_LABELS.get(base_key, base_key.capitalize())
    asc_map = data.get("ascensionAdd", {}).get("attribute", {}).get("ascension", {})
    if not asc_map:
        return [f"Sub-Attribute: {base}"]

    all_vals = {}
    for asc_num in (0, 1, 2, 3, 4):
        attr_val = asc_map.get(str(asc_num))
        all_vals[asc_num] = ATTR_LABELS.get(attr_val, attr_val.capitalize()) if attr_val else base

    if len(set(all_vals.values())) == 1:
        return [f"Sub-Attribute: {base}"]

    grouped = {}
    for asc_num, label in sorted(all_vals.items()):
        grouped.setdefault(label, []).append(_ASC_DISPLAY[asc_num])

    lines = []
    for label, ascs in sorted(grouped.items(), key=lambda x: min(x[1])):
        asc_label = fmt_asc_ordinal(sorted(set(ascs)))
        lines.append(f"[{asc_label}]")
        lines.append(f"Sub-Attribute: {label}")
    return lines


def fmt_alignment_blocks(data):
    """Format Alignment line(s)."""
    base_traits = [t for t in data.get("traits", []) if t.get("name", "").startswith("alignment")]
    indv = data.get("ascensionAdd", {}).get("individuality", {}).get("ascension", {})
    if not indv:
        return [f"Alignment: {_join_trait_labels(base_traits, TRAIT_ID_LABELS)}"]

    all_aligns = {}
    for a in (0, 1, 2, 3, 4):
        t_list = indv.get(str(a), [])
        m_align = [t for t in t_list if t.get("name", "").startswith("alignment")]
        all_aligns[a] = m_align or base_traits

    first_ids = tuple(sorted(t["id"] for t in all_aligns[0]))
    if all(tuple(sorted(t["id"] for t in v)) == first_ids for v in all_aligns.values()):
        return [f"Alignment: {_join_trait_labels(all_aligns[0], TRAIT_ID_LABELS)}"]

    groups = {}
    for a in (0, 1, 2, 3, 4):
        key = tuple(sorted(t["id"] for t in all_aligns[a]))
        groups.setdefault(key, []).append(_ASC_DISPLAY[a])

    lines = []
    for trait_ids, ascs in sorted(groups.items(), key=lambda item: min(item[1])):
        asc_label = fmt_asc_ordinal(sorted(set(ascs)))
        matching = next(t for t in all_aligns.values() if tuple(sorted(t2["id"] for t2 in t)) == trait_ids)
        label = _join_trait_labels(matching, TRAIT_ID_LABELS)
        lines.append(f"[{asc_label}]")
        lines.append(f"Alignment: {label}")
    return lines


def fmt_gender_blocks(data):
    """Format Gender line(s)."""
    base_traits = [t for t in data.get("traits", []) if t.get("name", "").startswith("gender")]
    indv = data.get("ascensionAdd", {}).get("individuality", {}).get("ascension", {})
    if not indv:
        return [f"Gender: {_join_trait_labels(base_traits, TRAIT_ID_LABELS)}"]

    all_genders = {}
    for a in (0, 1, 2, 3, 4):
        t_list = indv.get(str(a), [])
        m_gender = [t for t in t_list if t.get("name", "").startswith("gender")]
        all_genders[a] = m_gender or base_traits

    first_ids = tuple(sorted(t["id"] for t in all_genders[0]))
    if all(tuple(sorted(t["id"] for t in v)) == first_ids for v in all_genders.values()):
        return [f"Gender: {_join_trait_labels(all_genders[0], TRAIT_ID_LABELS)}"]

    groups = {}
    for a in (0, 1, 2, 3, 4):
        key = tuple(sorted(t["id"] for t in all_genders[a]))
        groups.setdefault(key, []).append(_ASC_DISPLAY[a])

    lines = []
    for trait_ids, ascs in sorted(groups.items(), key=lambda item: min(item[1])):
        asc_label = fmt_asc_ordinal(sorted(set(ascs)))
        matching = next(t for t in all_genders.values() if tuple(sorted(t2["id"] for t2 in t)) == trait_ids)
        label = _join_trait_labels(matching, TRAIT_ID_LABELS)
        lines.append(f"[{asc_label}]")
        lines.append(f"Gender: {label}")
    return lines


_ASC_DISPLAY = {0: 1, 1: 2, 2: 2, 3: 3, 4: 3}


def fmt_trait_by_asc(data, trait_prefix, label_map):
    """Resolve a trait value across ascensions from individuality data."""
    base_traits = [t for t in data.get("traits", []) if t.get("name", "").startswith(trait_prefix)]
    indv = data.get("ascensionAdd", {}).get("individuality", {}).get("ascension", {})
    if not indv:
        return _join_trait_labels(base_traits, label_map)

    by_asc = {}
    for asc_key, traits in sorted(indv.items()):
        asc_num = int(asc_key)
        matching = [t for t in traits if t.get("name", "").startswith(trait_prefix)]
        by_asc[asc_num] = matching if matching else base_traits

    if not any(by_asc.values()):
        return _join_trait_labels(base_traits, label_map)

    first_val = next(iter(by_asc.values()))
    first_ids = tuple(sorted(t["id"] for t in first_val))
    all_same = all(
        tuple(sorted(t["id"] for t in v)) == first_ids for v in by_asc.values()
    )
    if all_same:
        return _join_trait_labels(first_val, label_map)

    grouped = {}
    for asc_num, traits in sorted(by_asc.items()):
        key = tuple(sorted(t["id"] for t in traits))
        grouped.setdefault(key, []).append(_ASC_DISPLAY[asc_num])

    parts = []
    for trait_ids, ascs in grouped.items():
        trait = next(
            t
            for t in by_asc.values()
            if tuple(sorted(t2["id"] for t2 in t)) == trait_ids
        )
        label = _join_trait_labels(trait, label_map)
        asc_label = fmt_asc_ordinal(sorted(set(ascs)))
        parts.append(f"{label}({asc_label})")
    return ", ".join(parts)


def _join_trait_labels(traits, label_map):
    """Join trait labels with '-' for multi-value traits (e.g. alignment)."""
    labels = [
        label_map.get(t["id"], t.get("name", "Unknown")) for t in sorted(traits, key=lambda x: x["id"])
    ]
    return "-".join(labels) if labels else "Unknown"


def fmt(n):
    return f"{n:,}"


def fmt_val_range(v0, v9, divisor, is_pct):
    def process(v):
        if v is None:
            return None
        r = v / divisor if divisor > 1 else v
        return int(r) if isinstance(r, float) and r == int(r) else r

    pv0 = process(v0)
    pv9 = process(v9)
    suffix = "%" if is_pct else ""
    if pv0 is None:
        return ""
    if pv9 is None or pv0 == pv9:
        return f"{pv0}{suffix}"
    return f"{pv0}-{pv9}{suffix}"


def fmt_condition(turn, count):
    parts = []
    if count > 0:
        parts.append(f"{count} time{'s' if count > 1 else ''}")
    if turn > 0:
        parts.append(f"{turn} turn{'s' if turn > 1 else ''}")
    return f"({', '.join(parts)})" if parts else ""


def fmt_hp_cond(buff):
    script = buff.get("script", {})
    hp_lower = script.get("HP_LOWER")
    hp_higher = script.get("HP_HIGHER")
    if hp_lower is not None:
        pct = hp_lower // 10
        return f" while HP is {pct}%" if pct == 1 else f" while HP is {pct}% or less"
    if hp_higher is not None:
        pct = hp_higher // 10
        return f" while HP is {pct}%" if pct == 100 else f" while HP is {pct}% or more"
    return ""


def oc_last(fn, svals):
    last = (
        fn.get("svals5")
        or fn.get("svals4")
        or fn.get("svals3")
        or fn.get("svals2")
        or svals
    )
    return last[0] if last else {}


def fmt_asc_label(asc_set):
    if not asc_set:
        return ""
    return (
        "&".join(ASC_ORD.get(str(a), f"{a}th") for a in sorted(asc_set)) + " Ascension"
    )


def get_ascension_conditions(item, svt_id, svt_key=None):
    """Extract ascension numbers from releaseConditions."""
    if svt_key:
        ssvt = next((s for s in item.get(svt_key, []) if s.get("svtId") == svt_id), None)
        if not ssvt:
            return set()
        conditions = ssvt.get("releaseConditions", [])
    else:
        conditions = item.get("releaseConditions", [])

    ascs = set()
    for c in conditions:
        if c["condType"] == "equipWithTargetCostume":
            num = c["condNum"]
            if 1 <= num <= 4:
                ascs.add(num if num < 4 else 3)
            elif svt_id in (800100, 304800) and num in (11, 12, 13):
                ascs.add(3)
    return ascs


def group_and_label_items(items, svt_id, item_prefix, svt_key=None, include_num=True):
    """Group items by num, then by strengthStatus, and assign strengthen/ascension tags."""
    groups = {}
    for item in items:
        groups.setdefault(item.get("num", 1), []).append(item)

    result = []
    for num in sorted(groups):
        group = sorted(groups[num], key=lambda x: x["id"])
        by_ss = {}
        for item in group:
            ss = item.get("strengthStatus", 0)
            by_ss.setdefault(ss, []).append(item)

        def _ss_sort_key(ss):
            items_in_ss = by_ss[ss]
            prios = [it["priority"] for it in items_in_ss if it.get("priority") is not None]
            if prios:
                return (0, min(prios), 1 if ss == 99 else 0, -ss)
            if 99 in by_ss:
                return (1, 1 if ss == 99 else 0, -ss if ss > 0 else -1000, 0)
            return (1, 0, ss, 0)

        sorted_ss = sorted(by_ss.keys(), key=_ss_sort_key)
        for i, ss in enumerate(sorted_ss):
            sub_group = by_ss[ss]
            prefix = f"{item_prefix} {num}" if include_num else item_prefix
            strengthen_tag = ""
            if len(sorted_ss) > 1 and i > 0:
                if len(sorted_ss) == 2:
                    strengthen_tag = " [Strengthen]"
                else:
                    strengthen_tag = f" [{STRENGTH_ORDINALS[i - 1]} Strengthen]"

            if len(sub_group) > 1:
                item_to_ascs, all_defined = {}, set()
                for item in sub_group:
                    ascs = get_ascension_conditions(item, svt_id, svt_key)
                    item_to_ascs[item["id"]] = ascs
                    all_defined.update(ascs)

                possible = {1, 2, 3}
                remaining = possible - all_defined
                undefined_items = [it for it in sub_group if not item_to_ascs[it["id"]]]
                if len(undefined_items) == 1 and remaining:
                    item_to_ascs[undefined_items[0]["id"]] = remaining

                def _asc_sort_key(it):
                    ascs = item_to_ascs.get(it["id"], set())
                    min_asc = min(ascs) if ascs else 999
                    variant_order = 1 if it.get("_is_variant") else 0
                    return (min_asc, variant_order, it.get("priority", 0), it["id"])

                sorted_sub_group = sorted(sub_group, key=_asc_sort_key)

                for item in sorted_sub_group:
                    asc_label = fmt_asc_label(item_to_ascs[item["id"]])
                    asc_tag = f" [{asc_label}]" if asc_label else ""
                    label = f"{prefix} ({item['name']}){strengthen_tag}{asc_tag}"
                    result.append((item, label))
            else:
                item = sub_group[0]
                label = f"{prefix} ({item['name']}){strengthen_tag}"
                result.append((item, label))
    return result


def find_transform_svt_id(data):
    """Find secondary servant ID for transform servants (e.g. Aoko, Prélati, Jekyll)."""
    relate_transform = data.get("relateId", {}).get("transform")
    if relate_transform:
        if isinstance(relate_transform, list) and relate_transform:
            tid = relate_transform[0]
            if tid != data.get("id"):
                return tid
        elif isinstance(relate_transform, int) and relate_transform != data.get("id"):
            return relate_transform

    for sk in data.get("skills", []) + data.get("noblePhantasms", []):
        for fn in sk.get("functions", []):
            if fn.get("funcType") == "transformServant":
                svals = fn.get("svals") or [{}]
                if svals:
                    tid = svals[0].get("Value")
                    if tid and tid != data.get("id"):
                        return tid
    return None


def is_mash(svt_id):
    """Check if servant ID corresponds to Mash Kyrielight (800100 / No. 1)."""
    if svt_id is None:
        return False
    return str(svt_id) in ("1", "800100")


def detect_costume_form(release_conditions):
    """Detect costume form from releaseConditions."""
    for r in (release_conditions or []):
        if r.get("condType") == "equipWithTargetCostume":
            c = r.get("condNum")
            if c in (12, 13, 18):
                return "Spiritron Dress: Ortinax"
            elif c in (17, 19, 20):
                return "Spiritron Dress: Paladin"
    return "All Ascensions"


def resolve_costume_forms(data):
    """Dynamically resolve multi-form configuration for costume-based servants like Mash Kyrielight."""
    if not data:
        return None
    svt_id = str(data.get("id"))
    is_mash_svt = svt_id in ("1", "800100") or str(data.get("collectionNo")) == "1"
    if not is_mash_svt:
        return None

    base_attr = (data.get("attribute") or "earth").capitalize()
    paladin_attr = "Human"
    asc_add = data.get("ascensionAdd", {})
    attr_cos = asc_add.get("attribute", {}).get("costume", {})
    for cid, at in attr_cos.items():
        if cid in ("800190", "800200", "800210"):
            paladin_attr = at.capitalize()
            break

    def _get_cos_overwrite(field_name, default_val):
        field_dict = asc_add.get(field_name, {}).get("costume", {})
        for k in ("800190", "800200", "800210", "17", "19", "20"):
            if k in field_dict:
                return field_dict[k]
        return default_val

    base_hp = data.get("hpBase")
    max_hp = data.get("hpMax")
    base_atk = data.get("atkBase")
    max_atk = data.get("atkMax")
    base_rarity = data.get("rarity")

    paladin_hp_base = _get_cos_overwrite("overwriteHpBase", base_hp)
    paladin_hp_max = _get_cos_overwrite("overwriteHpMax", max_hp)
    paladin_atk_base = _get_cos_overwrite("overwriteAtkBase", base_atk)
    paladin_atk_max = _get_cos_overwrite("overwriteAtkMax", max_atk)
    paladin_rarity = _get_cos_overwrite("overwriteRarity", base_rarity)

    forms = {
        0: {
            "index": 0,
            "key": "all_ascensions",
            "label": "All Ascensions",
            "name": "All Ascensions",
            "attribute": base_attr,
            "hpBase": base_hp,
            "hpMax": max_hp,
            "atkBase": base_atk,
            "atkMax": max_atk,
            "rarity": base_rarity,
            "changeName": False,
            "changeIcon": True,
            "costume_ids": ["800130", "800160", "800170"],
        },
        1: {
            "index": 1,
            "key": "spiritron_dress_ortinax",
            "label": "Spiritron Dress: Ortinax",
            "name": "Spiritron Dress: Ortinax",
            "attribute": base_attr,
            "hpBase": base_hp,
            "hpMax": max_hp,
            "atkBase": base_atk,
            "atkMax": max_atk,
            "rarity": base_rarity,
            "changeName": False,
            "changeIcon": True,
            "costume_ids": ["800140", "800150"],
        },
        2: {
            "index": 2,
            "key": "spiritron_dress_paladin",
            "label": "Spiritron Dress: Paladin",
            "name": "Spiritron Dress: Paladin",
            "attribute": paladin_attr,
            "hpBase": paladin_hp_base,
            "hpMax": paladin_hp_max,
            "atkBase": paladin_atk_base,
            "atkMax": paladin_atk_max,
            "rarity": paladin_rarity,
            "changeName": False,
            "changeIcon": True,
            "costume_ids": ["800190", "800210"],
        },
    }
    return forms


def fold_chained_functions(functions: list) -> list[tuple[dict, int]]:
    """Group consecutive chained conditional roll functions."""
    if not functions:
        return []
    result = []
    i = 0
    n = len(functions)
    while i < n:
        fn = functions[i]
        sv0 = (fn.get("svals") or [{}])[0]
        rate0 = sv0.get("Rate", 1000)
        if rate0 > 0:
            j = i + 1
            while j < n:
                fn_next = functions[j]
                sv_next = (fn_next.get("svals") or [{}])[0]
                rate_next = sv_next.get("Rate", 1000)
                if (
                    rate_next == -abs(rate0)
                    and fn_next.get("funcType") == fn.get("funcType")
                    and fn_next.get("funcTargetType") == fn.get("funcTargetType")
                    and [b.get("id") for b in fn_next.get("buffs", [])]
                    == [b.get("id") for b in fn.get("buffs", [])]
                    and sv_next.get("Value") == sv0.get("Value")
                    and sv_next.get("Turn") == sv0.get("Turn")
                    and sv_next.get("Count") == sv0.get("Count")
                ):
                    j += 1
                else:
                    break
            count = j - i
            if count > 1:
                result.append((fn, count))
                i = j
                continue
        result.append((fn, 1))
        i += 1
    return result


def append_chained_roll_tag(text: str, count: int) -> str:
    """Append '<applied again if successful, up to a maximum of {count} times>' before the target phrase."""
    if count <= 1 or not text:
        return text
    tag = f"<applied again if successful, up to a maximum of {count} times>"
    demerit = " [Demerit]" if text.endswith(" [Demerit]") else ""
    if demerit:
        text = text[: -len(demerit)].rstrip()
    targets = [
        " for yourself",
        " for all allies",
        " for one ally",
        " for all enemies",
        " to all enemies",
        " to a single enemy",
        " for an ally",
        " for self",
    ]
    for tgt in targets:
        if text.endswith(tgt):
            base = text[: -len(tgt)].rstrip()
            return f"{base} {tag}{tgt}{demerit}"
    return f"{text} {tag}{demerit}"
