"""Master servant presentation builder and markdown serializer.

Implements the offline api -> formatted -> md data pipeline using in-memory
servant and skill lookup dictionaries (zero per-servant HTTP requests).
"""

from .context import FetchContext
from .utils import (
    CARD_MAP,
    CARD_NAMES,
    fmt_attribute,
    fmt_attribute_blocks,
    fmt_alignment_blocks,
    fmt_gender_blocks,
    fmt_trait_by_asc,
    fmt,
    find_transform_svt_id,
    is_mash,
    resolve_costume_forms,
)
from .effect_map import TRAIT_ID_LABELS
from .skill_formatter import (
    format_skills_structured,
    skills_to_markdown,
    format_passives_structured,
    passives_to_markdown,
    format_append_skills_structured,
    append_skills_to_markdown,
)
from .np_formatter import (
    format_np_structured,
    np_to_markdown,
)

# Declarative form identity metadata for multi-form transform servants (no external URLs)
FORM_IDENTITY_OVERRIDES = {
    505600: {
        "1": {
            "changeIcon": True,
            "changeName": True,
            "name": "Francesca Prelati",
            "originalName": "フランチェスカ・プレラーティ",
        }
    },
    600700: {
        "1": {
            "changeIcon": True,
            "changeName": False,
            "fallbackBaseImage": True,
        }
    },
}


def _make_lookup(mapping):
    """Create a lookup callable that accepts int or str IDs from an in-memory dict."""
    if not mapping:
        return None

    def _lookup(item_id):
        if item_id in mapping:
            return mapping[item_id]
        if isinstance(item_id, str) and item_id.isdigit():
            int_id = int(item_id)
            if int_id in mapping:
                return mapping[int_id]
        return mapping.get(str(item_id))

    return _lookup


def format_profile_structured(
    data,
    ctx=None,
    transform_data=None,
    transform_svt_id=None,
    availability="",
) -> dict:
    name, no = data["name"], data["collectionNo"]
    rarity = data["rarity"]
    rarity_str = f"{rarity}\u2605{f' {availability}' if availability else ''}"
    costume_forms = resolve_costume_forms(data)

    def _extract_profile_form(
        svt_obj,
        form_label,
        global_idx=0,
        attr_override=None,
        align_override=None,
        gender_override=None,
        hp_base=None,
        hp_max=None,
        atk_base=None,
        atk_max=None,
        rarity_override=None,
    ):
        p_cls = svt_obj.get("className", "").capitalize()
        p_attr = attr_override or fmt_attribute(svt_obj)
        p_align = align_override or fmt_trait_by_asc(svt_obj, "alignment", TRAIT_ID_LABELS)
        p_gender = gender_override or fmt_trait_by_asc(svt_obj, "gender", TRAIT_ID_LABELS)
        p_cards = "".join(CARD_MAP.get(str(c), "?") for c in svt_obj.get("cards", []))
        p_hits = svt_obj.get("hitsDistribution", {})
        hit_keys = ("2", "1", "3", "4")
        if not any(k in p_hits for k in hit_keys):
            hit_keys = ("buster", "arts", "quick", "extra")
        p_hit_lines = [
            f"{CARD_NAMES[k]} {len(p_hits[k])} {'Hit' if len(p_hits[k]) == 1 else 'Hits'}"
            for k in hit_keys
            if k in p_hits
        ]
        curr_hp_base = hp_base if hp_base is not None else svt_obj.get("hpBase")
        curr_hp_max = hp_max if hp_max is not None else svt_obj.get("hpMax")
        curr_atk_base = atk_base if atk_base is not None else svt_obj.get("atkBase")
        curr_atk_max = atk_max if atk_max is not None else svt_obj.get("atkMax")
        clean_label = form_label[3:].strip() if form_label.startswith("If ") else form_label.strip()

        return {
            "label": clean_label,
            "globalFormIndex": global_idx,
            "className": p_cls,
            "alignment": p_align,
            "subAttr": p_attr,
            "gender": p_gender,
            "rarity": rarity_override if rarity_override is not None else svt_obj.get("rarity", rarity),
            "hpBase": curr_hp_base,
            "hpMax": curr_hp_max,
            "atkBase": curr_atk_base,
            "atkMax": curr_atk_max,
            "cardDeck": p_cards,
            "hits": p_hit_lines,
        }

    if is_mash(data.get("id")):
        f0 = costume_forms[0]
        f2 = costume_forms[2]
        forms = [
            _extract_profile_form(
                data,
                f0["label"],
                global_idx=0,
                attr_override=f0.get("attribute"),
                hp_base=f0.get("hpBase"),
                hp_max=f0.get("hpMax"),
                atk_base=f0.get("atkBase"),
                atk_max=f0.get("atkMax"),
                rarity_override=f0.get("rarity"),
            ),
            _extract_profile_form(
                data,
                f2["label"],
                global_idx=2,
                attr_override=f2.get("attribute"),
                hp_base=f2.get("hpBase"),
                hp_max=f2.get("hpMax"),
                atk_base=f2.get("atkBase"),
                atk_max=f2.get("atkMax"),
                rarity_override=f2.get("rarity"),
            ),
        ]
        return {
            "name": name,
            "collectionNo": no,
            "rarity": rarity,
            "rarityStr": rarity_str,
            "isMultiForm": True,
            "forms": forms,
        }

    if costume_forms:
        forms = []
        for f_idx in sorted(costume_forms.keys()):
            f_info = costume_forms[f_idx]
            forms.append(
                _extract_profile_form(
                    data,
                    f_info["label"],
                    global_idx=f_idx,
                    attr_override=f_info.get("attribute"),
                    hp_base=f_info.get("hpBase"),
                    hp_max=f_info.get("hpMax"),
                    atk_base=f_info.get("atkBase"),
                    atk_max=f_info.get("atkMax"),
                    rarity_override=f_info.get("rarity"),
                )
            )
        return {
            "name": name,
            "collectionNo": no,
            "rarity": rarity,
            "rarityStr": rarity_str,
            "isMultiForm": True,
            "forms": forms,
        }

    if transform_data:
        main_name = TRAIT_ID_LABELS.get(data["id"], data.get("name", "Form 1"))
        trans_name = TRAIT_ID_LABELS.get(
            transform_data["id"], transform_data.get("name", "Form 2")
        )
        if main_name == trans_name:
            main_name, trans_name = "Form 1", "Form 2"
        forms = [
            _extract_profile_form(data, main_name, global_idx=0),
            _extract_profile_form(transform_data, trans_name, global_idx=1),
        ]
        return {
            "name": name,
            "collectionNo": no,
            "rarity": rarity,
            "rarityStr": rarity_str,
            "isMultiForm": True,
            "forms": forms,
        }

    # Standard single-form servant
    form0 = _extract_profile_form(data, "", global_idx=0)
    return {
        "name": name,
        "collectionNo": no,
        "rarity": rarity,
        "rarityStr": rarity_str,
        "isMultiForm": False,
        "forms": [form0],
        "alignmentBlocks": fmt_alignment_blocks(data),
        "attributeBlocks": fmt_attribute_blocks(data),
        "genderBlocks": fmt_gender_blocks(data),
    }


def profile_to_markdown(profile: dict) -> list:
    lines = [profile["name"], f"No.{profile['collectionNo']}"]
    rarity_str = profile.get("rarityStr", "")
    forms = profile.get("forms", [])

    if profile.get("isMultiForm"):
        lines.append(f"Rarity {rarity_str}")
        for form in forms:
            lines.append("")
            clean_tag = form["label"][3:].strip() if form["label"].startswith("If ") else form["label"].strip()
            lines.append(f"[{clean_tag}]")
            lines.extend([
                f"Class {form['className']}",
                f"Alignment: {form['alignment']}",
                f"Sub-Attribute: {form['subAttr']}",
                f"Gender: {form['gender']}",
                "",
                "HP",
                f"Base: {fmt(form['hpBase'])} Max: {fmt(form['hpMax'])}",
                "ATK",
                f"Base: {fmt(form['atkBase'])} Max: {fmt(form['atkMax'])}",
                "",
                f"Card {form['cardDeck']}",
                *form["hits"],
            ])
    else:
        form0 = forms[0] if forms else {}
        lines.extend([
            f"Class {form0.get('className', '')}",
            f"Rarity {rarity_str}",
            *profile.get("alignmentBlocks", []),
            *profile.get("attributeBlocks", []),
            *profile.get("genderBlocks", []),
            "",
            "HP",
            f"Base: {fmt(form0.get('hpBase'))} Max: {fmt(form0.get('hpMax'))}",
            "ATK",
            f"Base: {fmt(form0.get('atkBase'))} Max: {fmt(form0.get('atkMax'))}",
            "",
            f"Card {form0.get('cardDeck', '')}",
            *form0.get("hits", []),
        ])
    return lines


def build_formatted_servant(
    data,
    availability="",
    ctx=None,
    svt_by_id=None,
    skill_by_id=None,
) -> dict:
    # Detect counter name for states
    counter_name = None
    for psk in data.get("classPassive", []):
        for pfn in psk.get("functions", []):
            pbufs = pfn.get("buffs", [])
            if pbufs and pbufs[0].get("type") == "addIndividuality":
                pb = pbufs[0]
                psv = (pfn.get("svals") or [{}])[0]
                if (
                    pb.get("name")
                    and psv.get("ShowState", 0) == 1
                    and psv.get("Count", -1) > 0
                ):
                    counter_name = pb["name"]
                    break
        if counter_name:
            break

    if ctx is None:
        ctx = FetchContext(
            fetch=_make_lookup(svt_by_id),
            fetch_inner_skill=_make_lookup(skill_by_id),
            counter_name=counter_name,
            svt_data=data,
        )
    else:
        if ctx.counter_name is None:
            ctx.counter_name = counter_name
        if ctx.svt_data is None:
            ctx.svt_data = data

    transform_svt_id = find_transform_svt_id(data)
    transform_data = None
    if transform_svt_id and ctx and ctx.fetch:
        try:
            transform_data = ctx.fetch(transform_svt_id)
        except Exception:
            transform_data = None

    profile = format_profile_structured(
        data,
        ctx=ctx,
        transform_data=transform_data,
        transform_svt_id=transform_svt_id,
        availability=availability,
    )
    skills = format_skills_structured(
        data.get("skills", []),
        data["id"],
        ctx=ctx,
        transform_skills=transform_data.get("skills", []) if transform_data else None,
        transform_svt_id=transform_svt_id,
    )
    noble_phantasms = format_np_structured(
        data.get("noblePhantasms", []),
        data["id"],
        ctx=ctx,
        transform_nps=transform_data.get("noblePhantasms", []) if transform_data else None,
        transform_svt_id=transform_svt_id,
    )
    passives = format_passives_structured(
        data,
        ctx=ctx,
        transform_passives=transform_data.get("classPassive", []) if transform_data else None,
        transform_svt_id=transform_svt_id,
    )
    append_skills = format_append_skills_structured(data, ctx=ctx)

    slots = [*skills, *noble_phantasms, *passives, *append_skills]

    form_config = resolve_costume_forms(data)
    if not form_config and transform_data:
        main_name = TRAIT_ID_LABELS.get(data["id"], data.get("name", "Form 1"))
        trans_name = TRAIT_ID_LABELS.get(
            transform_svt_id, transform_data.get("name", "Form 2")
        )
        same_name = main_name == trans_name
        main_label = "Form 1" if same_name else main_name
        trans_label = "Form 2" if same_name else trans_name
        form_config = {
            "0": {
                "index": 0,
                "label": main_label,
                "name": main_name,
                "key": main_label.lower(),
            },
            "1": {
                "index": 1,
                "label": trans_label,
                "name": trans_name,
                "key": trans_label.lower(),
            },
        }
        if same_name:
            form_config["0"]["changeName"] = False
            form_config["1"]["changeName"] = False
        overrides = FORM_IDENTITY_OVERRIDES.get(data["id"], {})
        for f_key, override in overrides.items():
            if f_key in form_config:
                form_config[f_key].update(override)

    return {
        "profile": profile,
        "skills": skills,
        "noblePhantasms": noble_phantasms,
        "passives": passives,
        "appendSkills": append_skills,
        "slots": slots,
        "formConfig": form_config,
    }


def formatted_to_md(formatted: dict) -> str:
    lines = []
    lines.extend(profile_to_markdown(formatted["profile"]))
    lines.extend(skills_to_markdown(formatted["skills"]))
    lines.extend(np_to_markdown(formatted["noblePhantasms"]))
    lines.extend(passives_to_markdown(formatted["passives"]))
    lines.extend(append_skills_to_markdown(formatted.get("appendSkills", [])))
    return "\n".join(lines)


def convert(data, availability="", ctx=None, svt_by_id=None, skill_by_id=None) -> str:
    formatted = build_formatted_servant(
        data,
        availability=availability,
        ctx=ctx,
        svt_by_id=svt_by_id,
        skill_by_id=skill_by_id,
    )
    return formatted_to_md(formatted)
