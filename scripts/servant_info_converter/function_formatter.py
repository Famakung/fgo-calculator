import re
from dataclasses import dataclass

from .effect_map import (
    FUNC_TYPE_NO_BUFF,
    FuncTypeEntry,
    BuffTypeEntry,
    BUFF_TYPE_MAP,
    TARGET_LABELS,
    TRAIT_ID_LABELS,
    HP_REDUCE_LABELS,
    JP_BUFF_NAME_MAP,
)
from .context import FetchContext
from .utils import (
    TRIGGER_INFO,
    AILMENT_IGNORE,
    INDIVIDUALITIE_IGNORE,
    FIELD_TRAITS,
    ASC_ORD,
    CARD_NAMES,
    get_card_prefix,
    apply_card_prefix,
    is_demerit,
    apply_tvals_target,
    fmt_trait_name,
    fmt_quest_field_target,
    fmt_val_range,
    fmt_condition,
    fmt_hp_cond,
    oc_last,
)


# ---------------------------------------------------------------------------
# Shared context for effect-type handlers
# ---------------------------------------------------------------------------


@dataclass
class _CoreCtx:
    """Shared context for effect-type handlers."""

    fn: dict
    sv0: dict
    sv9: dict
    svals: list
    func_type: str
    target_type: str
    target: str
    tvals: list
    cond_str: str
    on_field_str: str
    val0: int = None
    val9: int = None
    oc_times_cond: str = None
    oc_times_tag: str = ""
    ctx: FetchContext = None


# ---------------------------------------------------------------------------
# Module-level helpers (lifted from nested closures)
# ---------------------------------------------------------------------------


def _fmt_mult(m):
    """Format a multiplier value, removing unnecessary trailing zeros."""
    return str(int(m)) if m == int(m) else f"{m:.2f}".rstrip("0").rstrip(".")


def _get_np_type(np_data):
    """Determine the NP type (AOE, Single-Target, Damage, Support) from NP function data."""
    for f in np_data.get("functions", []):
        ft = f.get("funcType", "")
        if ft.startswith("damageNp"):
            tt = f.get("funcTargetType", "")
            if tt == "enemyAll":
                return "AOE"
            elif tt in ("enemy", "enemyOther"):
                return "Single-Target"
    return "Support"


def _get_trigger_prefix(sv0, ctx=None) -> str:
    sv_trigger_pos = sv0.get("TriggeredFuncPosition")
    dis_type = sv0.get("DisplayLastFuncInvalidType")
    if sv_trigger_pos is None and "DisplayLastFuncInvalidType" not in sv0:
        return ""

    ref_fn = None
    if ctx and hasattr(ctx, "functions") and ctx.functions and sv_trigger_pos is not None:
        pos = abs(sv_trigger_pos)
        if 1 <= pos <= len(ctx.functions):
            ref_fn = ctx.functions[pos - 1]

    if ref_fn is not None:
        ref_type = ref_fn.get("funcType", "")
        if ref_type in ("addState", "addStateShort"):
            tvals = ref_fn.get("functvals", [])
            if tvals:
                traits = []
                for t in tvals:
                    tid = t.get("id")
                    tname = TRAIT_ID_LABELS.get(tid, fmt_trait_name(t))
                    traits.append(f"[{tname}]")
                if len(traits) > 2:
                    joined = ", ".join(traits[:-1]) + f" or {traits[-1]}"
                else:
                    joined = " or ".join(traits)
                target_suffix = ""
                ref_target = ref_fn.get("funcTargetType", "")
                if ref_target in ("ptOtherFull", "ptOther", "other"):
                    target_suffix = " excluding yourself"
                elif ref_target in ("enemyAll", "enemyOne", "enemy"):
                    target_suffix = " on enemy side"
                return f"When {joined} is on field{target_suffix}, "
        elif ref_type == "displayBuffstring":
            ref_sv0 = (ref_fn.get("svals") or [{}])[0]
            star_higher = ref_sv0.get("StarHigher")
            if star_higher is not None and (dis_type == 1 or sv_trigger_pos < 0):
                return f"If there are less than {star_higher} Critical Stars, "
        elif ref_type == "instantDeath":
            if sv_trigger_pos == -1 or dis_type == -1 or dis_type == 1:
                return (
                    "When Death not succeeds, "
                    if (dis_type == 1 or sv_trigger_pos == -1)
                    else "When Death succeeds, "
                )

    return ""


def _camel_to_title(s):
    """Convert camelCase string to Title Case words."""
    words, word = [], ""
    for ch in s:
        if ch.isupper() and word:
            words.append(word)
            word = ch
        else:
            word += ch
    if word:
        words.append(word)
    return " ".join(w.capitalize() for w in words)


# ---------------------------------------------------------------------------
# Trigger / Delay function formatters
# ---------------------------------------------------------------------------


def _is_engine_cleanup_hook(fn, inner_skill):
    """Detect if trigger function only removes internal tracking traits after attack/damage."""
    buff = fn.get("buffs", [{}])[0]
    btype = buff.get("type", "")
    if btype not in (
        "commandattackAfterFunction",
        "commandattackAfterFunctionMainOnly",
        "attackAfterFunction",
        "attackAfterFunctionMainOnly",
    ):
        return False
    inner_fns = [
        f
        for f in (inner_skill or {}).get("functions", [])
        if f.get("funcType") not in ("displayBuffstring",)
    ]
    if not inner_fns:
        return False
    for ifn in inner_fns:
        if ifn.get("funcType") != "subState":
            return False
        if ifn.get("funcTargetType") in ("enemy", "enemyOne", "enemyAll"):
            return False
        traits = ifn.get("traitVals", [])
        if not traits:
            return False
        for t in traits:
            if t.get("id", 0) < 2000 or t.get("id", 0) in (3004, 3005):
                return False
    return True


def _parse_stack_consumption_loop(inner_skill, buff):
    """Detect if inner_skill is a stack-consumption loop of repeating (subState, addState/addStateShort) pairs."""
    inner_fns = [
        f
        for f in (inner_skill or {}).get("functions", [])
        if f.get("funcType") not in ("displayBuffstring",)
    ]
    if not inner_fns or len(inner_fns) % 2 != 0:
        return None

    sub_fn0 = inner_fns[0]
    add_fn0 = inner_fns[1]
    if sub_fn0.get("funcType") != "subState" or not sub_fn0.get("traitVals"):
        return None
    if add_fn0.get("funcType") not in ("addState", "addStateShort") or not add_fn0.get("buffs"):
        return None

    trait_obj = sub_fn0["traitVals"][0]
    trait_id = trait_obj.get("id", 0)
    # Ignore generic buff/debuff removals
    if trait_id in (3004, 3005) or "buff" in trait_obj.get("name", "").lower():
        return None

    # Stack consumption requires consuming a stack from self/party and applying buff to self/party
    if sub_fn0.get("funcTargetType") not in ("self", "ptOne", "ptAll"):
        return None
    if add_fn0.get("funcTargetType") not in ("self", "ptOne", "ptAll"):
        return None

    trait_name = TRAIT_ID_LABELS.get(trait_id, fmt_trait_name(trait_obj))

    buff_type = add_fn0["buffs"][0].get("type")
    buff_val = (add_fn0.get("svals") or [{}])[0].get("Value", 0)

    num_pairs = len(inner_fns) // 2
    for i in range(num_pairs):
        sub_fn = inner_fns[2 * i]
        add_fn = inner_fns[2 * i + 1]
        if sub_fn.get("funcType") != "subState" or not sub_fn.get("traitVals"):
            return None
        if sub_fn["traitVals"][0].get("id") != trait_id:
            return None
        if sub_fn.get("funcTargetType") != sub_fn0.get("funcTargetType"):
            return None
        if add_fn.get("funcType") not in ("addState", "addStateShort") or not add_fn.get("buffs"):
            return None
        if add_fn["buffs"][0].get("type") != buff_type:
            return None
        if add_fn.get("funcTargetType") != add_fn0.get("funcTargetType"):
            return None
        if (add_fn.get("svals") or [{}])[0].get("Value", 0) != buff_val:
            return None

    entry = BUFF_TYPE_MAP.get(buff_type)
    if not entry or not entry.template:
        return None
    if "{val}" not in entry.template or "{traits}" in entry.template:
        return None

    divisor = entry.divisor or 1
    val_str = f"{buff_val // divisor}%" if entry.is_pct else str(buff_val // divisor)
    buff_action = entry.template.format(val=val_str)
    if buff_action:
        buff_action = buff_action[0].lower() + buff_action[1:]

    ck_self = buff.get("ckSelfIndv", [])
    is_extra = any(t.get("id") == 4004 and not t.get("negative") for t in ck_self)
    is_normal = any(t.get("id") == 4004 and t.get("negative") for t in ck_self)
    if is_normal:
        trig = "When normal attacking"
    elif is_extra:
        trig = "When performing an Extra Attack"
    else:
        card_t = next(
            (t.get("id") for t in ck_self if t.get("id") in {4001, 4002, 4003}), None
        )
        if card_t:
            cname = TRAIT_ID_LABELS.get(card_t, "Command Card")
            trig = f"When attacking with {cname} Cards"
        else:
            trig = "When attacking"

    single_trait_name = (
        trait_name[:-1]
        if trait_name.endswith("s") and not trait_name.endswith("ss")
        else trait_name
    )

    if num_pairs == 1:
        return f"{trig}, consume 1 [{single_trait_name}] to {buff_action} (1 time) for yourself"
    else:
        return f"{trig}, consume all [{trait_name}] to {buff_action} per [{single_trait_name}] consumed (1 time) for yourself"


def fmt_trigger_function(fn, outer_svals, ctx=None) -> str | None:
    buff = fn["buffs"][0]
    if buff.get("id") == 3712:
        return (
            'Inflict Ending of Dreams <Apply a state that "Removes Buffs & Apply [Eternal Slumber] '
            '<nullify Resistance, unable to remove, unable to select Sacrifice, unable to Order Change> '
            '& Apply Target Focus (3 turns)" at turn end> (1 time) for a single ally '
            '<nullify Resistance, unable to remove> [Demerit]'
        )
    sv0 = outer_svals[0] if outer_svals else {}
    inner_skill_id = sv0.get("SkillID") or sv0.get("Value")
    if not inner_skill_id:
        return "[trigger: no inner_skill_id in svals[0]]"

    info = TRIGGER_INFO.get(buff["type"])
    if info:
        action, timing, is_normal = info
        traits = buff.get("ckSelfIndv", [])[:]
        script_indv = buff.get("script", {}).get("INDIVIDUALITIE")
        if script_indv:
            traits.append(script_indv)

        trait_labels = []
        for t in traits:
            if t["id"] == 4008:
                continue
            if t.get("negative") and t["id"] == 10050:
                label = "Non-Critical"
            else:
                label = TRAIT_ID_LABELS.get(t["id"], fmt_trait_name(t))
                if t.get("negative"):
                    label = f"Non-{label}"
            if label == "NP" and "NP" in action:
                continue
            if label not in trait_labels:
                trait_labels.append(str(label))

        trait_str = " ".join(trait_labels)
        if trait_str:
            trait_str += " "

        prefix = "Normal " if is_normal else ""
        timing_str = f" {timing}" if timing else ""

        if action == "damaged":
            trigger_phrase = f"when {trait_str}damaged"
        elif action == "Guts is activated":
            trigger_phrase = f"when {trait_str}Guts is activated"
        else:
            trigger_phrase = f"when {trait_str}{prefix}{action}{timing_str}"
    else:
        trigger_phrase = "when attacking"

    outer_turn = sv0.get("Turn", -1)
    outer_count = sv0.get("Count", -1)
    outer_cond = fmt_condition(outer_turn, outer_count)
    outer_cond_str = f" {outer_cond}" if outer_cond else ""

    inner_skill = (
        ctx.fetch_inner_skill(inner_skill_id) if ctx and ctx.fetch_inner_skill else None
    )

    if _is_engine_cleanup_hook(fn, inner_skill):
        return None

    stack_loop_res = _parse_stack_consumption_loop(inner_skill, buff)
    if stack_loop_res is not None:
        return stack_loop_res

    inner_parts = []

    use_rate0 = sv0.get("UseRate")
    use_rate9 = (outer_svals[-1] if outer_svals else {}).get("UseRate")
    if use_rate0 or use_rate9:
        rate_str = fmt_val_range(use_rate0, use_rate9, 10, False)
        rate_prefix = f"has {rate_str}% chance to trigger "
    else:
        rate_prefix = ""

    is_enemy_target = (
        fn.get("funcTargetType") in ("enemy", "enemyOne", "enemyAll")
        or fn.get("funcTargetTeam") == "enemy"
    )

    for raw_inner_fn in (inner_skill or {}).get("functions", []):
        raw_inner_team = raw_inner_fn.get("funcTargetTeam")
        inner_func_type = raw_inner_fn.get("funcType", "")
        inner_target_type = raw_inner_fn.get("funcTargetType", "")
        if inner_func_type in ("displayBuffstring", "hastenNpturn"):
            continue
        if inner_func_type == "delayNpturn" and inner_target_type in ("self", "ptOne", "ptAll"):
            continue
        if raw_inner_team == "enemy" and inner_func_type != "delayNpturn":
            continue
        inner_fn = dict(raw_inner_fn)
        # Pass target team context to inner functions without mutating cached skill
        inner_fn["funcTargetTeam"] = fn.get("funcTargetTeam")

        inner_svals = inner_fn.get("svals", [])
        inner_sv0 = inner_svals[0] if inner_svals else {}
        inner_sv9 = inner_svals[-1] if inner_svals else {}
        inner_turn = inner_sv0.get("Turn", -1)
        inner_count = inner_sv0.get("Count", -1)
        inner_cond = fmt_condition(inner_turn, inner_count)
        inner_cond_str = f" {inner_cond}" if inner_cond else ""
        inner_target = TARGET_LABELS.get(
            inner_fn["funcTargetType"], inner_fn["funcTargetType"]
        )

        if inner_func_type == "subState" and inner_fn.get("traitVals"):
            remove_count = inner_sv0.get("Value2", 1)
            trait = inner_fn["traitVals"][0]
            label = TRAIT_ID_LABELS.get(trait["id"], fmt_trait_name(trait))
            trait_label = (
                label if label == "Debuff" or trait["id"] >= 3000 else f"[{label}]"
            )
            inner_parts.append(f"Remove {remove_count} {trait_label} {inner_target}")
            continue

        inner_buffs = inner_fn.get("buffs", [])
        if not inner_buffs:
            target_str = f" {inner_target}"
            if inner_func_type == "gainStar":
                val = fmt_val_range(
                    inner_sv0.get("Value", 0), inner_sv9.get("Value", 0), 1, False
                )
                inner_parts.append(f"Gain Critical Stars by {val}")
            elif inner_func_type == "subBattlePoint":
                val = inner_sv0.get("Target") or inner_sv0.get("BattlePointValue") or inner_sv0.get("Value", 0)
                inner_parts.append(f"Reduces the fullness gauge by {val}{inner_cond_str}")
            elif inner_func_type == "addBattlePoint":
                val = inner_sv0.get("BattlePointValue") or inner_sv0.get("Value", 0)
                inner_parts.append(f"Increases Fullness gauge by {val}{inner_cond_str}{target_str}")
            elif inner_func_type in ("gainNpFromTargets", "gainHpFromTargets"):
                delegated = _fmt_function_core(inner_fn, ctx=ctx)
                if delegated:
                    inner_parts.append(delegated)
            elif inner_func_type in FUNC_TYPE_NO_BUFF:
                entry = FUNC_TYPE_NO_BUFF[inner_func_type]
                template, divisor, is_pct = entry.template, entry.divisor, entry.is_pct
                use_rate = entry.use_rate
                val_key = "Rate" if use_rate else "Value"
                demerit_suffix = (
                    " [Demerit]" if is_demerit(inner_fn) and not is_enemy_target else ""
                )
                if divisor == 0:
                    inner_parts.append(f"{template}{inner_cond_str}{target_str}{demerit_suffix}")
                else:
                    val_str = fmt_val_range(
                        inner_sv0.get(val_key), inner_sv9.get(val_key), divisor, is_pct
                    )
                    inner_parts.append(
                        f"{template.format(val=val_str)}{inner_cond_str}{target_str}{demerit_suffix}"
                    )
            else:
                inner_parts.append(
                    f"[trigger: unknown inner funcType: {inner_func_type}]"
                )
            continue

        inner_buff_id = inner_buffs[0]["id"]
        inner_buff_type = inner_buffs[0]["type"]
        inner_val0 = inner_sv0.get("Value")
        inner_val9 = inner_sv9.get("Value")

        if inner_buff_type == "reduceHp":
            ailment_ids = [
                v
                for v in inner_buffs[0].get("vals", [])
                if v["id"] not in AILMENT_IGNORE
            ]
            ailment = (
                fmt_trait_name(ailment_ids[0])
                if ailment_ids
                else inner_buffs[0]["name"]
            )
            val_str = fmt_val_range(inner_val0, inner_val9, 1, False)
            inner_parts.append(
                f"Inflict {ailment} by {val_str}{inner_cond_str} {inner_target}"
            )
            continue

        if inner_buff_type == "addIndividuality":
            trait_id = inner_sv0.get("Value")
            valid_vals = [
                v for v in inner_buffs[0].get("vals", [])
                if v.get("id") not in (3004, 3005, 3009)
            ]
            label = (
                (TRAIT_ID_LABELS.get(trait_id) if trait_id and trait_id != 9999 else None)
                or inner_buffs[0].get("name")
                or (fmt_trait_name(valid_vals[0]) if valid_vals else None)
                or (fmt_trait_name(trait_id) if trait_id and trait_id != 9999 else None)
            )
            if not label:
                continue
            inner_parts.append(f"Apply [{label}]{inner_cond_str} {inner_target}")
            continue

        inner_rate0 = inner_sv0.get("Rate", 1000)
        inner_rate9 = inner_sv9.get("Rate", 1000)
        inner_rate_prefix = (
            f"{fmt_val_range(inner_rate0, inner_rate9, 10, False)}% chance to "
            if inner_rate0 != 1000 or inner_rate9 != 1000
            else ""
        )

        if inner_buff_type == "donotAct":
            ailment_ids = [
                v
                for v in inner_buffs[0].get("vals", [])
                if v["id"] not in AILMENT_IGNORE
            ]
            ailment = (
                fmt_trait_name(ailment_ids[0])
                if ailment_ids
                else inner_buffs[0]["name"]
            )
            inner_parts.append(f"{inner_rate_prefix}Inflict {ailment}{inner_cond_str} {inner_target}")
            continue

        if inner_buff_type == "delayFunction":
            delayed = fmt_delay_fn(inner_fn, ctx=ctx)
            if not delayed:
                if "即死" in inner_buffs[0].get("detail", "") or inner_buff_id == 5441:
                    delayed = f'After {inner_turn if inner_turn > 0 else 1} turn "Apply Death {inner_target} [Demerit]"{inner_cond_str} {inner_target}'
                else:
                    bname = JP_BUFF_NAME_MAP.get(inner_buffs[0].get("name", ""), inner_buffs[0].get("name", "Delayed Effect"))
                    delayed = f"Apply [{bname}]{inner_cond_str} {inner_target}"
            inner_parts.append(delayed)
            continue

        if inner_buff_type in BUFF_TYPE_MAP:
            entry = BUFF_TYPE_MAP[inner_buff_type]
        else:
            inner_parts.append(f"[unknown buff id: {inner_buff_id}] {inner_target}")
            continue

        template, divisor, is_pct = entry.template, entry.divisor, entry.is_pct
        if template is None:
            delegated = fmt_function(inner_fn, ctx=ctx)
            if delegated:
                inner_parts.append(f"{inner_rate_prefix}{delegated}")
            else:
                inner_parts.append(f"{inner_rate_prefix}{inner_buffs[0].get('name', inner_buff_type)} {inner_target}")
            continue
        if "{traits}" in template:
            ck_hp = [
                HP_REDUCE_LABELS[t["id"]]
                for t in inner_buffs[0].get("ckSelfIndv", [])
                if t.get("id") in HP_REDUCE_LABELS
            ]
            if ck_hp:
                template = template.replace("{traits}", " / ".join(ck_hp))
        card_prefix = get_card_prefix(inner_buffs[0])
        template = apply_card_prefix(inner_buff_type, template, card_prefix)

        demerit_suffix = (
            " [Demerit]" if is_demerit(inner_fn) and not is_enemy_target else ""
        )
        if divisor == 0:
            part = f"{template}{inner_cond_str} {inner_target}{demerit_suffix}"
        else:
            val_str = fmt_val_range(inner_val0, inner_val9, divisor, is_pct)
            if "{traits}" in template:
                tvals = (
                    inner_buffs[0].get("tvals", [])
                    or inner_buffs[0].get("ckOpIndv", [])
                    or inner_buffs[0].get("ckSelfIndv", [])
                )
                traits_str = " / ".join(fmt_trait_name(t) for t in tvals) if tvals else "Target"
                rendered = template.format(val=val_str, traits=traits_str)
            else:
                rendered = template.format(val=val_str)
            part = f"{rendered}{inner_cond_str} {inner_target}{demerit_suffix}"

        state_trait_vals = [
            v
            for v in inner_buffs[0].get("vals", [])
            if (v.get("id", 0) >= 10000 or v.get("id", 0) in (3121, 3122))
            and v.get("id", 0) not in AILMENT_IGNORE
        ]
        if not state_trait_vals and inner_buffs[0].get("vals"):
            state_trait_vals = [
                v
                for v in inner_buffs[0].get("vals", [])
                if v.get("id", 0) in TRAIT_ID_LABELS
                and v.get("id", 0) >= 3000
                and v.get("id", 0) not in AILMENT_IGNORE
                and v.get("id", 0) not in (
                    3004, 3005, 3006, 3007, 3008, 3009, 3010,
                    3011, 3012, 3013, 3014, 3015, 3018, 3021, 3022, 3024, 3025, 3026,
                    3027, 3030, 3031, 3032, 3039, 3040, 3041, 3043, 3049, 3052, 3058,
                    3067, 3083, 3086, 3089, 3099, 3102, 3103, 3110,
                )
            ]
        if state_trait_vals:
            st = state_trait_vals[0]
            st_label = TRAIT_ID_LABELS.get(st["id"], fmt_trait_name(st))
            part = f"[{st_label}] <{part}>"

        trig_pos = inner_sv0.get("TriggeredFuncPosition")
        if trig_pos is not None or "DisplayLastFuncInvalidType" in inner_sv0:
            trig_prefix = _get_trigger_prefix(inner_sv0, ctx=ctx)
            if trig_prefix:
                part = f"{trig_prefix}{part}"

        inner_parts.append(part)

    if buff.get("type") == "lastSelfturnprogressFunction":
        trait_vals = [v for v in buff.get("vals", []) if v["id"] >= 3000 and v["id"] not in AILMENT_IGNORE]
        trait_name = buff.get("name", "Countdown")
        if trait_vals:
            trait_name = TRAIT_ID_LABELS.get(trait_vals[0]["id"], fmt_trait_name(trait_vals[0]))

        target_type = fn.get("funcTargetType", "")
        outer_target = TARGET_LABELS.get(target_type, f"for {target_type}")

        if inner_parts:
            return (
                f'Apply [{trait_name}] <Apply a state when countdown reaches 0 to trigger {rate_prefix}"{" & ".join(inner_parts)}">{outer_cond_str} {outer_target}'
            )
        return f"Apply [{trait_name}]{outer_cond_str} {outer_target}"

    if buff.get("type") in ("selfturnendFunction", "selfturnstartFunction"):
        timing_str = "at turn start" if buff.get("type") == "selfturnstartFunction" else "at turn end"
        trait_vals = [v for v in buff.get("vals", []) if v["id"] >= 3000 and v["id"] not in AILMENT_IGNORE]
        trait_name = ""
        if trait_vals:
            trait_name = TRAIT_ID_LABELS.get(trait_vals[0]["id"], fmt_trait_name(trait_vals[0]))
        elif buff.get("name") and buff.get("name", "").lower() not in ("triggers each turn", "毎ターン発動"):
            raw_bname = buff.get("name")
            trait_name = JP_BUFF_NAME_MAP.get(raw_bname, raw_bname)

        target_type = fn.get("funcTargetType", "")
        outer_target = TARGET_LABELS.get(target_type, f"for {target_type}")

        if trait_name:
            if inner_parts:
                return (
                    f'Inflict {trait_name} <Apply a state that {rate_prefix}"{" & ".join(inner_parts)}" '
                    f"{timing_str}>{outer_cond_str} {outer_target}"
                )
            return f"Inflict {trait_name}{outer_cond_str} {outer_target}"

        if inner_parts:
            tag_traits = [
                TRAIT_ID_LABELS[v["id"]]
                for v in buff.get("vals", [])
                if v.get("id") in TRAIT_ID_LABELS
                and v.get("id") not in AILMENT_IGNORE
                and v.get("id") != 3004
            ]
            tag_str = f" with [{tag_traits[0]}]" if tag_traits else ""
            if outer_turn == -1 and outer_count == -1:
                if len(inner_parts) > 1 and len(set(inner_parts)) == 1:
                    first_p = inner_parts[0]
                    m = re.search(r"Apply \[([^\]]+)\]", first_p)
                    if m:
                        counter_name = m.group(1)
                        return f"Gain {len(inner_parts)} [{counter_name}] each turn {timing_str} {outer_target}"
                elif len(inner_parts) == 1:
                    p = inner_parts[0]
                    if " by " in p:
                        pre, post = p.split(" by ", 1)
                        return f"{pre} each turn {timing_str} by {post}"
                    elif p.endswith(outer_target):
                        base_p = p[: -len(outer_target)].strip()
                        return f"{base_p} each turn {timing_str} {outer_target}"
                    else:
                        return f"{p} each turn {timing_str}"
            return (
                f'Apply a state{tag_str} that {rate_prefix}"{" & ".join(inner_parts)}" '
                f"{timing_str}{outer_cond_str} {outer_target}"
            )
        return f"Inflict {buff.get('name', '')}{outer_cond_str} {outer_target}"

    that_verb = ""
    if inner_parts and inner_parts[0].startswith("["):
        is_inner_enemy = (
            any(
                ifn.get("funcTargetType") in ("enemy", "enemyOne", "enemyAll")
                or ifn.get("funcTargetTeam") == "enemy"
                for ifn in (inner_skill or {}).get("functions", [])
            )
            or any(
                "for one enemy" in p
                or "for all enemies" in p
                or "to a single enemy" in p
                or "to all enemies" in p
                for p in inner_parts
            )
        )
        that_verb = "inflicts " if is_inner_enemy else "applies "

    target_type = fn.get("funcTargetType", "")
    outer_target = apply_tvals_target(
        TARGET_LABELS.get(target_type, "for yourself"), fn.get("functvals", [])
    )

    if not inner_parts and inner_skill is None:
        if inner_skill_id == 970917:
            inner_parts = ["Reduces the fullness gauge by 1"]
        elif inner_skill_id == 961313:
            inner_parts = ["Decrease DEF for one enemy"]
        else:
            label = buff.get("name") or "Trigger"
            return f"Apply a state ({label}) {trigger_phrase}{outer_cond_str} {outer_target}"

    return (
        f'Apply a state that {that_verb}{rate_prefix}"{" & ".join(inner_parts)}" '
        f"{trigger_phrase}{outer_cond_str} {outer_target}"
    )


def fmt_delay_fn(fn, ctx=None) -> str | None:
    sv0 = (fn.get("svals") or [{}])[0]
    inner_skill_id = sv0.get("Value")
    if not inner_skill_id:
        return None
    inner_skill = (
        ctx.fetch_inner_skill(inner_skill_id) if ctx and ctx.fetch_inner_skill else None
    )
    delay_turn = sv0.get("Turn", 1)
    delay_str = f"After {delay_turn} turn{'s' if delay_turn > 1 else ''}"
    outer_cond = fmt_condition(sv0.get("Turn", -1), sv0.get("Count", -1))
    outer_cond_str = f" {outer_cond}" if outer_cond else ""
    target_type = fn.get("funcTargetType", "")
    outer_target = TARGET_LABELS.get(target_type, f"for {target_type}")
    inner_parts = []
    for ifn in (inner_skill or {}).get("functions", []):
        if ifn.get("funcType") == "moveToLastSubmember":
            inner_parts.append(
                "Retreat to the sub-member slot <cannot retreat if there is only 1 allied Servant on the field>"
            )
            continue
        r = _fmt_function_core(ifn, ctx=ctx)
        if r:
            inner_parts.append(r)
    for add_id in ((inner_skill or {}).get("script") or {}).get("additionalSkillId", []):
        add_sk = (
            ctx.fetch_inner_skill(add_id) if ctx and ctx.fetch_inner_skill else None
        )
        if add_sk:
            for ifn in add_sk.get("functions", []):
                if ifn.get("funcType") == "moveToLastSubmember":
                    inner_parts.append(
                        "Retreat to the sub-member slot <cannot retreat if there is only 1 allied Servant on the field>"
                    )
                    continue
                r = _fmt_function_core(ifn, ctx=ctx)
                if r:
                    inner_parts.append(r)
        elif add_id == 970412 or ((fn.get("buffs") or [{}])[0].get("id") == 5447):
            inner_parts.append(
                "Retreat to the sub-member slot <cannot retreat if there is only 1 allied Servant on the field>"
            )
    if not inner_parts:
        return None
    return f'{delay_str} "{" & ".join(inner_parts)}"{outer_cond_str} {outer_target}'


# ---------------------------------------------------------------------------
# Core context resolution
# ---------------------------------------------------------------------------


_ANIMAL_TRAIT_IDS = {2005, 2632, 2821}


def _is_solo_enemy_down_crit(fn, buff_type, target_type, ctx) -> bool:
    """Allow enemy-team downCriticalrate only when no downCriticalpoint or lossStar companion exists."""
    if buff_type != "downCriticalrate" or target_type not in ("enemy", "enemyOne", "enemyAll"):
        return False
    fns = getattr(ctx, "functions", None) or []
    return bool(fns) and not any(
        (f.get("buffs") and f["buffs"][0].get("type") == "downCriticalpoint")
        or f.get("funcType") == "lossStar"
        for f in fns
    )


def _is_internal_hide_miss(func_type, buff_type, sv0) -> bool:
    """Identify internal engine hooks marked HideMiss=1 that should stay hidden."""
    if sv0.get("HideMiss") != 1:
        return False
    if func_type == "moveState" and sv0.get("HideNoEffect") == 1:
        return True
    if sv0.get("ShowState") != -1:
        return False
    if buff_type in ("addIndividuality", "skillRankUp", "delayFunction", "donotReplace"):
        return True
    if buff_type == "avoidState" and sv0.get("Rate", 1000) < 0:
        return True
    if buff_type == "upDamage" and (sv0.get("Value") or 0) == 0:
        return True
    if buff_type == "attackAfterFunctionMainOnly" and sv0.get("UnSubStateWhileLinkedToOthers") == 1:
        return True
    return False


def _fmt_buff_script_indv(buff, target, ctx) -> str:
    """Format buff.script INDIVIDUALITIE / INDIVIDUALITIE_OR conditions into target."""
    script = buff.get("script", {})
    buff_type_str = buff.get("type", "")
    is_td_change = buff_type_str in (
        "tdTypeChange",
        "tdTypeChangeArts",
        "tdTypeChangeBuster",
        "tdTypeChangeQuick",
    )
    if is_td_change:
        return target

    indv = script.get("INDIVIDUALITIE")
    if indv and indv.get("id") not in INDIVIDUALITIE_IGNORE:
        prefix = "not " if indv.get("negative") else ""
        label = TRAIT_ID_LABELS.get(indv["id"], fmt_trait_name(indv))
        if indv.get("id") in FIELD_TRAITS:
            return f"only when {prefix}on a [{label}] field {target}"
        return f"if {prefix}[{label}] {target}"

    indv_or = [t for t in script.get("INDIVIDUALITIE_OR", []) if t.get("id") not in INDIVIDUALITIE_IGNORE]
    if not indv_or:
        return target

    # Resolve internal (>=10000) marker traits back to their addIndividuality definitions in ctx.functions
    resolved_ids = []
    has_internal_field_check = False
    ctx_fns = getattr(ctx, "functions", None) or []
    for t in indv_or:
        tid = t.get("id")
        if tid and tid >= 10000 and ctx_fns:
            matched = False
            for f in ctx_fns:
                fb = f.get("buffs") or []
                fsv = (f.get("svals") or [{}])[0]
                if fb and fb[0].get("type") == "addIndividuality" and fsv.get("Value") == tid:
                    and_list = fb[0].get("script", {}).get("INDIVIDUALITIE_AND", [])
                    for at in and_list:
                        if not at.get("negative") and at.get("id") not in resolved_ids:
                            resolved_ids.append(at.get("id"))
                            matched = True
                    if matched:
                        has_internal_field_check = True
            if not matched and tid not in resolved_ids:
                resolved_ids.append(tid)
        elif tid is not None and tid not in resolved_ids:
            resolved_ids.append(tid)

    if _ANIMAL_TRAIT_IDS.issubset(set(resolved_ids)):
        return f"only when [Animal] is on field {target}"

    if all(tid in FIELD_TRAITS for tid in resolved_ids):
        labels = [f"[{TRAIT_ID_LABELS.get(tid, fmt_trait_name(tid))}]" for tid in resolved_ids]
        joined = ", ".join(labels[:-1]) + f" or {labels[-1]}" if len(labels) > 2 else " or ".join(labels)
        return f"only when on a {joined} field {target}"

    labels = [f"[{TRAIT_ID_LABELS.get(tid, fmt_trait_name(tid))}]" for tid in resolved_ids]
    joined = ", ".join(labels[:-1]) + f" or {labels[-1]}" if len(labels) > 2 else " or ".join(labels)
    if has_internal_field_check:
        return f"only when {joined} is on field {target}"
    return f"if {joined} {target}"


def _resolve_core_context(fn, sv_start=None, sv_end=None, ctx=None) -> _CoreCtx | None:
    """Pre-process a function dict into a _CoreCtx, or return None for early exits."""
    func_type = fn.get("funcType", "")
    target_type = fn.get("funcTargetType", "")
    buffs = fn.get("buffs", [])
    svals = fn.get("svals", [])
    buff_type_str = buffs[0].get("type", "") if buffs else ""

    _ENEMY_TEAM_ALLOWED = {"delayNpturn"}
    if fn.get("funcTargetTeam") == "enemy" and func_type not in _ENEMY_TEAM_ALLOWED:
        is_enemy_down_npturnval = (
            buff_type_str == "downNpturnval"
            and target_type in ("enemy", "enemyOne", "enemyAll")
        )
        if (
            target_type != "commandTypeSelfTreasureDevice"
            and not is_enemy_down_npturnval
            and not _is_solo_enemy_down_crit(fn, buff_type_str, target_type, ctx)
        ):
            return None

    if func_type == "delayNpturn" and target_type in ("self", "ptOne", "ptAll"):
        return None

    sv0 = sv_start if sv_start is not None else (svals[0] if svals else {})
    if func_type == "displayBuffstring" and "CheckOverChargeStageRange" not in sv0:
        return None
    if func_type in (
        "hastenNpturn",
        "moveToLastSubmember",
        "none",
        "fixCommandcard",
    ):
        return None
    if func_type == "subState" and sv0.get("HideNoEffect") == 1:
        return None
    if func_type == "lossNp" and target_type == "enemyAll":
        return None

    if _is_internal_hide_miss(func_type, buff_type_str, sv0):
        return None

    target = TARGET_LABELS.get(target_type, target_type)
    if target_type == "noTarget":
        field_target = sv0.get("FieldBuffApplyTarget")
        if field_target == 1:
            target = "for all allies on the field"
        elif field_target == 2:
            target = "for all enemies on the field"
    if fn.get("funcId") in (23523, 23465) or any(
        "背後の味方" in b.get("detail", "") for b in buffs
    ):
        target = "for all allies behind yourself"
    elif target_type == "ptOtherFull" and buffs:
        buff_type = buffs[0].get("type", "")
        if buff_type.startswith("up") or buff_type in (
            "addMaxhp",
            "guts",
            "invincible",
            "addState",
            "subState",
        ):
            target = "for all allies (including sub-members) except yourself"

    tvals = fn.get("functvals", [])[:]
    overwrite_tvals = fn.get("overWriteTvalsList", []) or fn.get("script", {}).get(
        "overwriteTvals", []
    )
    if overwrite_tvals:
        if isinstance(overwrite_tvals[0], list):
            for group in overwrite_tvals:
                for t in group:
                    if t not in tvals:
                        tvals.append(t)
        else:
            for t in overwrite_tvals:
                if t not in tvals:
                    tvals.append(t)

    if tvals:
        new_target = apply_tvals_target(target, tvals)
        if new_target:
            target = new_target

    target = fmt_quest_field_target(fn, target)
    if buffs:
        target = _fmt_buff_script_indv(buffs[0], target, ctx)

    sv9 = sv_end if sv_end is not None else (svals[-1] if svals else {})

    val0 = sv0.get("Value")
    val9 = sv9.get("Value")
    turn = sv0.get("Turn", -1)
    count = sv0.get("Count", -1)
    cond = fmt_condition(turn, count, sv9.get("Turn", -1))
    cond_str = f" {cond}" if cond else ""
    on_field_str = " when you are on the field" if sv0.get("OnField") else ""

    oc_last_sv = oc_last(fn, svals)
    _count_oc5 = oc_last_sv.get("Count")
    oc_times_cond = None
    oc_times_tag = ""
    if count != -1 and _count_oc5 is not None and count != _count_oc5:
        _times_str = f"{count}-{_count_oc5} times"
        _turn_str = f"{turn} turn{'s' if turn != 1 else ''}" if turn > 0 else None
        oc_times_cond = (
            f" ({_times_str}, {_turn_str})" if _turn_str else f" ({_times_str})"
        )
        oc_times_tag = " <times increase with Overcharge>"

    return _CoreCtx(
        fn=fn,
        sv0=sv0,
        sv9=sv9,
        svals=svals,
        func_type=func_type,
        target_type=target_type,
        target=target,
        tvals=tvals,
        cond_str=cond_str,
        on_field_str=on_field_str,
        val0=val0,
        val9=val9,
        oc_times_cond=oc_times_cond,
        oc_times_tag=oc_times_tag,
        ctx=ctx,
    )


# ---------------------------------------------------------------------------
# Effect-type handlers — simple func types
# ---------------------------------------------------------------------------


def _handle_gain_star(core):
    """Handle the gainStar func type."""
    v0 = core.sv0.get("Value", 0)
    v9 = core.sv9.get("Value", 0)
    val_str = f"{v0}-{v9}" if v0 != v9 else str(v0)
    if core.target_type == "ptOther" and core.tvals:
        trait_labels = ", ".join(fmt_trait_name(t) for t in core.tvals)
        return f"Gain Critical Stars by {val_str} according to the number of allies [{trait_labels}] excluding yourself"
    return f"Gain Critical Stars by {val_str}"


def _handle_gain_multiply_np(core):
    """Handle the gainMultiplyNp func type."""
    mult0 = core.sv0.get("Value", 0) / 1000 + 1
    mult9 = core.sv9.get("Value", 0) / 1000 + 1
    val_str = (
        f"{_fmt_mult(mult0)}-{_fmt_mult(mult9)}x"
        if mult0 != mult9
        else f"{_fmt_mult(mult0)}x"
    )
    return f"Multiply NP Gauge by {val_str} {core.target}"


def _handle_sub_battle_point(core):
    """Handle the subBattlePoint func type."""
    v0 = core.sv0.get("Target") or core.sv0.get("BattlePointValue") or core.sv0.get("Value", 0)
    v9 = core.sv9.get("Target") or core.sv9.get("BattlePointValue") or core.sv9.get("Value", 0)
    val_str = f"{v0}-{v9}" if v0 != v9 else str(v0)
    return f"Reduces the fullness gauge by {val_str}{core.cond_str}"


def _handle_add_battle_point(core):
    """Handle the addBattlePoint func type."""
    v0 = core.sv0.get("BattlePointValue") or core.sv0.get("Value", 0)
    v9 = core.sv9.get("BattlePointValue") or core.sv9.get("Value", 0)
    val_str = f"{v0}-{v9}" if v0 != v9 else str(v0)
    return f"Increases Fullness gauge by {val_str}{core.cond_str} {core.target}"


# ---------------------------------------------------------------------------
# Effect-type handlers — buff-based dispatch
# ---------------------------------------------------------------------------


def _handle_selfturnend(core):
    """Handle the selfturnendFunction buff type."""
    buff = core.fn.get("buffs", [])[0]
    sv0 = core.sv0
    sv9 = core.sv9
    use_rate0 = sv0.get("UseRate", 0)
    use_rate9 = sv9.get("UseRate", 0)
    cond = fmt_condition(sv0.get("Turn", -1), sv0.get("Count", -1))
    cond_str_outer = f" {cond}" if cond else ""
    ailment_ids = [v for v in buff.get("vals", []) if v["id"] not in AILMENT_IGNORE]
    ailment = fmt_trait_name(ailment_ids[0]) if ailment_ids else buff["name"]
    use_rate_str = fmt_val_range(use_rate0, use_rate9, 10, False)
    if use_rate0 or use_rate9:
        rate_str = f"Inflict {ailment} by {use_rate_str}%"
    else:
        rate_str = f"Inflict {ailment}"
    return f"{rate_str}{cond_str_outer} {core.target}"


def _handle_skill_rank_up(core, buff):
    """Dynamically handle skillRankUp buff by looking up svt_data.script.SkillRankUp."""
    cond_str = core.cond_str
    target = core.target
    if core.ctx and getattr(core.ctx, "svt_data", None):
        rankup_map = core.ctx.svt_data.get("script", {}).get("SkillRankUp", {})
        non_empty = [(k, v) for k, v in rankup_map.items() if v]
        if len(non_empty) == 1:
            base_sk_id, target_ids = non_empty[0]
            inner_id = target_ids[0]
            inner_sk = (core.ctx.fetch_inner_skill(inner_id) if core.ctx.fetch_inner_skill else None) or {}
            sk_name = inner_sk.get("name")
            if sk_name:
                slot = None
                for sk in core.ctx.svt_data.get("skills", []):
                    if str(sk.get("id")) == str(base_sk_id):
                        slot = sk.get("num")
                        break
                slot_str = f"Skill {slot}" if slot else "Skill"
                return f"Change {slot_str} to [{sk_name}]{cond_str} {target}"
    return f"Apply [Skill Rank Up]{cond_str} {target}"


def _handle_td_type_change(core, buff):
    """Handle the tdTypeChange special buff handler."""
    sv0 = core.sv0
    cond_str = core.cond_str
    target = core.target

    if buff.get("name") == "聖剣装填" or "聖剣装填" in buff.get("originalName", ""):
        target_np_name = "Rayproof Kyrielight"
        if core.ctx and getattr(core.ctx, "svt_data", None):
            for np_item in core.ctx.svt_data.get("noblePhantasms", []):
                if np_item.get("card") in ("buster", "2") and "Rayproof" in np_item.get("name", ""):
                    target_np_name = np_item.get("name")
                    break
        return f"Apply [Holy Sword Loaded] & Change Noble Phantasm to [{target_np_name}]{cond_str} {target}"

    indv_val = buff.get("script", {}).get("INDIVIDUALITIE")
    svt_id = indv_val.get("id") if isinstance(indv_val, dict) else indv_val
    if not svt_id:
        return f"Change NP Card type to [Unknown Servant]{cond_str} {target}"

    svt_data = None
    if core.ctx and core.ctx.fetch:
        try:
            svt_data = core.ctx.fetch(svt_id)
        except Exception:
            return f"Change NP Card type to [Error Fetching Servant]{cond_str} {target}"
    if not svt_data:
        color = CARD_NAMES.get(str(sv0.get("Value")), "Unknown")
        if color != "Unknown":
            return f"Change NP Card type to [{color}]{cond_str} {target}"
        return f"Change NP Card type to [Unknown Servant]{cond_str} {target}"

    td_ids = None
    for np in svt_data.get("noblePhantasms", []):
        script = np.get("script", {})
        if "tdTypeChangeIDs" in script:
            td_ids = script["tdTypeChangeIDs"]
            break
    if not td_ids:
        color = CARD_NAMES.get(str(sv0.get("Value")), "Unknown")
        return f"Change NP Card type to [{color}]{cond_str} {target}"

    act_set = sv0.get("ActSet")
    act_sel = sv0.get("ActSelectIndex")
    if act_set is not None:
        idx = act_set - 1
    elif act_sel is not None:
        idx = (act_sel + 1) % len(td_ids)
    else:
        idx = 0
    if idx < 0 or idx >= len(td_ids):
        idx = 0

    target_np_id = td_ids[idx]
    all_nps = [n for n in svt_data.get("noblePhantasms", []) if n["id"] in td_ids]
    target_np = next((n for n in all_nps if n["id"] == target_np_id), None)
    if not target_np:
        return f"Change NP Card type to [Unknown Variant]{cond_str} {target}"

    all_types = [_get_np_type(n) for n in all_nps]
    all_colors = [n.get("card") for n in all_nps]
    same_type = len(set(all_types)) == 1
    same_color = len(set(all_colors)) == 1

    my_type = _get_np_type(target_np)
    my_color_val = target_np.get("card")
    my_color = CARD_NAMES.get(str(my_color_val), "Unknown")

    if same_color and same_type:
        label = my_color
    elif same_color and not same_type:
        label = my_type
    elif not same_color and same_type:
        label = my_color
    else:
        label = f"{my_color} ({my_type})"

    res_core_no_target = f"Change NP Card type to [{label}]{cond_str}"
    state_trait = None
    for v in buff.get("vals", []):
        if v["id"] >= 3000 and v["id"] not in AILMENT_IGNORE:
            state_trait = v
            break

    if state_trait:
        st_label = TRAIT_ID_LABELS.get(state_trait["id"], fmt_trait_name(state_trait))
        return f"Apply [{st_label}] <{res_core_no_target}> {target}"

    return f"{res_core_no_target} {target}"


def _handle_overwrite_class_relation(core, buff):
    """Handle the overwriteClassRelation special buff handler."""
    cond_str = core.cond_str
    target = core.target

    relation_id = buff.get("script", {}).get("relationId", {})
    atk_side = relation_id.get("atkSide", {})
    def_side = relation_id.get("defSide", {})

    atk_classes = set()
    for e in atk_side.values():
        atk_classes.update(e.keys())

    def_classes = set()
    for e in def_side.values():
        def_classes.update(e.keys())

    if atk_classes:
        class_names = ", ".join(_camel_to_title(c) for c in sorted(atk_classes))
        return f"Gain advantage against ({class_names}) class{cond_str} {target}"

    if def_classes:
        standard_classes = {
            "saber",
            "archer",
            "lancer",
            "rider",
            "caster",
            "assassin",
            "berserker",
        }
        if standard_classes.issubset(def_classes) or len(def_classes) >= 7:
            return f"Negate the DEF disadvantage due to Class attributes{cond_str} {target}"
        class_names = ", ".join(_camel_to_title(c) for c in sorted(def_classes))
        return f"Negate the DEF disadvantage due to Class attributes against ({class_names}) class{cond_str} {target}"

    return f"Negate the DEF disadvantage due to Class attributes{cond_str} {target}"


def _handle_multiattack(core, buff):
    """Handle multiattack buff (Musashi Fifth Force / Fifth Zenith)."""
    card_type = ""
    for t in buff.get("ckSelfIndv", []):
        tid = t.get("id")
        if tid in {4001, 4002, 4003, 4004}:
            label = TRAIT_ID_LABELS.get(tid, "")
            if label:
                card_type = f"{label} "
            break

    dmg_str = "0-30%"
    if core.ctx and core.ctx.functions:
        for fn in core.ctx.functions:
            fn_buffs = fn.get("buffs", [])
            if fn_buffs and fn_buffs[0].get("type") == "upDamage":
                svals = fn.get("svals", [])
                if svals:
                    v0 = svals[0].get("Value", 0) // 10
                    v9 = svals[-1].get("Value", 0) // 10
                    dmg_str = f"{v0}-{v9}%" if v0 != v9 else f"{v0}%"
                    break
    return f"Double the number of hits of normal {card_type}attacks (strength greatly decreases for each hit, but overall damage increases by {dmg_str}){core.cond_str} {core.target}"


def _handle_overwrite_svt_card_type(core, buff):
    """Handle overwriteSvtCardType buff (change card attacks to attack all enemies)."""
    card_name = None
    traits = (buff.get("ckSelfIndv") or []) + (buff.get("ckOpIndv") or [])
    for t in traits:
        tid = t.get("id")
        if tid in {4001, 4002, 4003, 4004}:
            card_name = TRAIT_ID_LABELS.get(tid, "")
            break

    if not card_name:
        val = (core.sv0 or {}).get("Value", 0)
        card_map = {
            1: "Arts",
            2: "Buster",
            3: "Quick",
            4: "Extra",
            101: "Arts",
            102: "Buster",
            103: "Quick",
            104: "Extra",
        }
        card_name = card_map.get(val, "")

    if not card_name and buff.get("name"):
        bname = buff.get("name", "")
        for cname in ("Extra", "Buster", "Arts", "Quick"):
            if cname.lower() in bname.lower():
                card_name = cname
                break

    if card_name == "Extra":
        target_cards = "Extra Attacks"
    elif card_name:
        target_cards = f"{card_name} Cards"
    else:
        target_cards = "Command Cards"

    template = f"Change {target_cards} to attack all enemies"
    entry = BUFF_TYPE_MAP.get("overwriteSvtCardType") or BuffTypeEntry(template, 0, False)
    hp_cond = fmt_hp_cond(buff)
    return _render_buff_template(
        core, buff, "overwriteSvtCardType", entry, template, 0, False, {}, hp_cond
    )


def _handle_buff_convert(core, buff):
    """Handle the buffConvert special buff handler."""
    script_convert = buff.get("script", {}).get("convert", {})
    targets = script_convert.get("targets", [])
    convert_buffs = script_convert.get("convertBuffs", [])

    from_name = targets[0].get("name", "Invincible") if targets else "Invincible"
    to_name = (
        convert_buffs[0].get("name", "Anti-Enforcement DEF")
        if convert_buffs
        else "Anti-Enforcement DEF"
    )

    template = f"Convert {from_name} effects granted to yourself into {to_name}"
    entry = BUFF_TYPE_MAP.get("buffConvert") or BuffTypeEntry(template, 0, False)
    hp_cond = fmt_hp_cond(buff)
    return _render_buff_template(
        core, buff, "buffConvert", entry, template, 0, False, {}, hp_cond
    )


def _handle_dead_function(core, buff):
    """Handle deadFunction buff triggers."""
    bid = buff.get("id")
    # Enemy-only charge/crit-rate fallback counterparts
    if bid in (1726, 5756, 6023):
        return None
    cond_str = core.cond_str
    target = core.target
    dead_map = {
        3016: 'Apply a state that "Restore HP by 1000-3000 for all allies" when defeated',
        5746: 'Apply a state that "Gain Critical Stars by 30" when defeated',
        4295: 'Apply a state that "Increase NP Gauge by 20-30% & Increase Critical Strength by 30-50% (3 turns) & Gain Critical Stars each turn by 5-15 (3 turns) of the back-most single ally, excluding yourself" when defeated',
        951: 'Apply a state that "Apply Invincible (2-3 times, 3 turns) for all allies & Restore HP by 1000-2000 for all allies" when defeated',
        1686: 'Apply a state that "Gain Critical Stars by 10-20" when defeated',
        4213: 'Inflict Taisui\'s Calamity <Apply a state that "Decrease DEF by 20% (3 turns) & Inflict Curse by 1000 (3 turns) & Inflict Disastrous Curse by 100% (3 turns) for all enemies" when defeated>',
        6022: 'Apply a state that "Increase NP Gauge by 10% for all allies" when defeated',
    }
    if bid in dead_map:
        return f"{dead_map[bid]}{cond_str} {target}"
    inner_id = core.sv0.get("Value")
    inner_sk = (
        core.ctx.fetch_inner_skill(inner_id)
        if inner_id and core.ctx and core.ctx.fetch_inner_skill
        else None
    )
    if inner_sk:
        parts = []
        for ifn in inner_sk.get("functions", []):
            r = _fmt_function_core(ifn, ctx=core.ctx)
            if r:
                parts.append(r)
        if parts:
            return f'Apply a state that "{" & ".join(parts)}" when defeated{cond_str} {target}'
    if bid == 5513 or inner_id == 970452:
        return f'Apply a state that "Increase NP Gauge for yourself" when an ally is defeated{cond_str} {target}'
    return f"Apply [Activate on Defeat]{cond_str} {target}"


def _handle_shorten_skill_after_use(core, buff):
    """Handle shortenSkillAfterUseSkill buff (Append 5 Skill Reload)."""
    val_str = fmt_val_range(core.val0, core.val9, 1, False)
    c0 = core.sv0.get("Count", -1)
    c9 = core.sv9.get("Count", -1)
    parts = []
    if c0 > 0:
        c_str = f"{c0}-{c9}" if c9 > 0 and c0 != c9 else str(c0)
        parts.append(f"{c_str} time{'s' if (c9 if c9 > 0 else c0) > 1 else ''}")
    max_each = core.sv0.get("ShortenMaxCountEachSkill")
    if max_each and max_each[0] > 0:
        parts.append(f"max {max_each[0]} time per skill")
    cond_part = f" ({', '.join(parts)})" if parts else core.cond_str
    return f"Reduce used skill's cooldown by {val_str} after Skill Use{cond_part} {core.target}"


def _handle_functioned_function(core, buff):
    """Handle functionedFunction buff triggers (Indra, Summer Huyan Zhuo)."""
    bid = buff.get("id")
    if bid == 5879:
        return None
    cond_str = core.cond_str
    target = core.target
    if bid == 5874:
        inner_id = core.sv0.get("Value")
        np_pct = "5%" if inner_id == 970722 else "10%"
        return f'Apply a state that "Increase NP Gauge by {np_pct} for yourself" when receiving HP recovery or Max HP Up{cond_str} {target}'
    if bid == 5908:
        return f'Apply a state that "Increase Quick Card effectiveness by 10% (3 turns, Max 10 stacks) for yourself" when receiving HP recovery or Max HP Up{cond_str} {target}'
    return f"Apply a state triggered when receiving an effect{cond_str} {target}"


def _handle_multi_guts_before(core, buff):
    """Handle multiGutsBeforeFunction buff (Lord Logres Knighthood Conferment A)."""
    return f'Apply a state that "Increase Guts HP recovery amount by 20% (1 time) & Increase ATK by 20% (3 turns) for the triggered ally" before Guts is activated on any ally excluding yourself{core.cond_str} {core.target}'


def _handle_td_post_after(core, buff):
    """Handle treasureDevicePostAfterFunction buff (Solomon Seal of Solomon E)."""
    if buff.get("id") == 5982:
        return None
    return f'Apply a state that "Increase NP Gauge by 20-30% based on NP consumed for yourself" when a [Caster] ally excluding yourself uses NP{core.cond_str} {core.target}'


def _handle_battle_point_trigger(core, buff):
    """Handle Space Ereshkigal Master Affection (Infinity Indicator EX) passive triggers."""
    btype = buff.get("type")
    bid = buff.get("id")
    cond_str = core.cond_str
    target = core.target
    if btype == "fieldIndividualityChangedFunction":
        return f'Apply a state that "Increases Master Affection gauge by 10 for yourself" when entering a [Near Water] field{cond_str} {target}'
    if btype == "confirmCommandFunction":
        if bid == 5653:
            return f'Apply a state that "Increases Master Affection gauge by 6 for yourself" when forming a Brave Chain{cond_str} {target}'
        return f'Apply a state that "Increases Master Affection gauge by 3 for yourself" when selecting a Command Card{cond_str} {target}'
    if btype == "skillBeforeFunction":
        if buff.get("script", {}).get("useFirstTimeInTurn"):
            return f'Apply a state that "Increases Master Affection gauge by 2 for yourself" when using a skill first in the turn{cond_str} {target}'
        return f'Apply a state that "Increases Master Affection gauge by 3 for yourself" when using a skill{cond_str} {target}'
    if btype == "skillTargetedBeforeFunction":
        if buff.get("script", {}).get("fromCommandSpell"):
            return f'Apply a state that "Increases Master Affection gauge by 10 for yourself" when targeted by a Command Spell{cond_str} {target}'
        return f'Apply a state that "Increases Master Affection gauge by 5 for yourself" when targeted by a Master Skill{cond_str} {target}'
    return None


def _handle_counter_function(core, buff):
    """Handle counterFunction buff (Manannán mac Lir (Bazett) Fragarach)."""
    return f'Apply [Fragarach Counter] <Counterattack with "Deal significant Quick damage by 600-1000% <effect increases with Level> & Decrease Quick Card resistance by 10% (3 turns) to a single enemy & Gain Critical Stars by 10" when targeted by an enemy\'s normal action>{core.cond_str} {core.target}'


def _handle_reflection_function(core, buff):
    """Handle reflectionFunction buff (Aŋra Mainiiu Verg Avesta)."""
    return f"Apply [Reflect Damage] <Deal damage to all enemies at enemy turn end equal to 2-3x the damage taken during the turn>{core.cond_str} {core.target}"


def _resolve_traits_from_config(core, buff, config, template, divisor, is_pct):
    """Resolve trait-based template modifications from config."""
    traits_raw = []
    source = config.get("trait_source")
    if source == "ckOpIndv":
        traits_raw = buff.get("ckOpIndv", [])
    elif source == "ckOpIndv_negative":
        traits_raw = [t for t in buff.get("ckOpIndv", []) if t.get("negative")]
    elif source == "ckSelfIndv":
        traits_raw = buff.get("ckSelfIndv", [])
    elif source == "ckSelfIndv_hp_reduce":
        traits_raw = buff.get("ckSelfIndv", [])
    elif source == "vals_ailment":
        traits_raw = [v for v in buff.get("vals", []) if v["id"] not in AILMENT_IGNORE]
        if not traits_raw and buff.get("name"):
            traits_raw = [{"name": buff["name"]}]
    elif source == "card_type_value":
        tid = core.sv0.get("Value")
        if tid:
            traits_raw = [{"name": CARD_NAMES.get(str(tid), str(tid))}]
    elif source == "sv0_value":
        tid = core.sv0.get("Value")
        valid_vals = [
            v for v in buff.get("vals", []) if v.get("id") not in (3004, 3005)
        ]
        if tid and tid != 9999 and tid in TRAIT_ID_LABELS:
            traits_raw = [{"id": tid}]
        elif valid_vals:
            traits_raw = valid_vals
        elif buff.get("name"):
            raw_bname = buff["name"]
            traits_raw = [{"name": JP_BUFF_NAME_MAP.get(raw_bname, raw_bname)}]
        elif tid and tid != 9999:
            traits_raw = [{"id": tid}]
    elif source == "vals_field":
        field_indiv = core.sv0.get("FieldIndividuality") or core.sv0.get("TargetList")
        if field_indiv:
            traits_raw = [{"id": tid} for tid in field_indiv]
        else:
            traits_raw = [
                v for v in buff.get("vals", [])
                if v.get("id") not in (3004, 3005)
            ]
    elif source == "hp_reduce_indiv":
        tid = core.sv0.get("HpReduceToRegainIndiv")
        if tid:
            traits_raw = [{"id": tid}]
        else:
            fallback = config.get("fallback_source")
            if fallback == "ckSelfIndv":
                traits_raw = buff.get("ckSelfIndv", [])
    if traits_raw:
        traits_raw = [
            t for t in traits_raw if t.get("id", 0) not in INDIVIDUALITIE_IGNORE
        ]
        t0_id = traits_raw[0].get("id", 0) if traits_raw else 0
        special_cases = config.get("special_cases", {})
        if t0_id in special_cases:
            template = special_cases[t0_id]
        else:
            template = config.get("trait_template", template)
            script_indv = buff.get("script", {}).get("INDIVIDUALITIE")
            if script_indv and script_indv.get("id") in INDIVIDUALITIE_IGNORE:
                status_id = script_indv["id"]
                status_label = TRAIT_ID_LABELS.get(
                    status_id, fmt_trait_name(script_indv)
                )
                template = (
                    template.replace(">", f" while {status_label} is applied>")
                    if " <" in template and ">" in template
                    else template + f" while {status_label} is applied"
                )
            raw_names = []
            trait_id_set = {t.get("id", 0) for t in traits_raw}
            for t in traits_raw:
                tid = t.get("id", 0)
                if tid in INDIVIDUALITIE_IGNORE:
                    continue
                if tid in (2018, 2040) and (trait_id_set & {1002, 1119, 2000}):
                    continue
                name = (
                    HP_REDUCE_LABELS[tid]
                    if source == "ckSelfIndv_hp_reduce" and tid in HP_REDUCE_LABELS
                    else (
                        TRAIT_ID_LABELS.get(tid, fmt_trait_name(t))
                        if tid != 0
                        else JP_BUFF_NAME_MAP.get(t.get("name", "Unknown"), t.get("name", "Unknown"))
                    )
                )
                if name not in raw_names:
                    raw_names.append(name)

            if config.get("oc_no_brackets") and core.oc_times_cond:
                join_sep = config.get("join_sep") or (
                    " with "
                    if buff.get("script", {}).get("checkIndvType") == 1
                    else " and "
                )
                traits_str = join_sep.join(raw_names)
            elif not config.get("brackets", True):
                join_sep = config.get("join_sep") or (
                    " with "
                    if buff.get("script", {}).get("checkIndvType") == 1
                    else " and "
                )
                traits_str = join_sep.join(raw_names)
            else:
                if len(raw_names) > 2:
                    traits_str = f"[{', '.join(raw_names[:-1])} and {raw_names[-1]}]"
                elif len(raw_names) == 2:
                    traits_str = f"[{raw_names[0]} and {raw_names[1]}]"
                elif len(raw_names) == 1:
                    traits_str = f"[{raw_names[0]}]"
                else:
                    traits_str = ""

            template = template.replace("{traits}", traits_str)
        divisor = config.get("divisor", divisor)
        is_pct = config.get("is_percent", is_pct)
    return template, divisor, is_pct


def _render_buff_template(
    core, buff, buff_type_str, entry, template, divisor, is_pct, config, hp_cond
):
    """Render the final formatted string from a buff template."""
    if template is None:
        template = ""
    trait_src = config.get("trait_source") if config else None
    already_resolved_ck = trait_src in (
        "ckOpIndv",
        "ckSelfIndv",
        "ckOpIndv_negative",
        "ckSelfIndv_hp_reduce",
    ) and bool(
        buff.get("ckOpIndv" if "ckOpIndv" in trait_src else "ckSelfIndv")
    )
    if not already_resolved_ck:
        card_prefix = get_card_prefix(buff)
        template = apply_card_prefix(buff_type_str, template, card_prefix)
    tag_traits = [
        TRAIT_ID_LABELS[v["id"]]
        for v in buff.get("vals", [])
        if v.get("id") in TRAIT_ID_LABELS and v.get("id") == 2911
    ]
    if tag_traits:
        tag_name = tag_traits[0]
        if " by {val}" in template:
            template = template.replace(" by {val}", f" with [{tag_name}] by {{val}}")
        elif "{val}" in template:
            template = template.replace("{val}", f"with [{tag_name}] {{val}}")
    use_rate = not config and isinstance(entry, FuncTypeEntry) and entry.use_rate
    val0 = core.val0
    val9 = core.val9
    if use_rate:
        val0 = core.sv0.get("Rate")
        val9 = core.sv9.get("Rate")
    op_cond_str = (
        " when receiving a Buff"
        if len(buff.get("ckOpIndv", [])) == 1
        and buff.get("ckOpIndv", [])[0]["id"] == 3004
        and "when receiving a Buff" not in template
        else ""
    )
    demerit_suffix = " [Demerit]" if is_demerit(core.fn) else ""
    _target = (
        {
            "enemy": "to a single enemy",
            "enemyOne": "to a single enemy",
            "enemyAll": "to all enemies",
        }.get(core.target_type, core.target)
        if config and config.get("target_override") == "inflict_target"
        else core.target
    )
    rate_prefix = (
        f"{fmt_val_range(core.sv0.get('Rate', 1000), core.sv9.get('Rate', 1000), 10, False)}% Chance to "
        if config and config.get("use_rate_prefix")
        else ""
    )
    if divisor == 0:
        _cond = core.oc_times_cond if core.oc_times_cond else core.cond_str
        res = f"{rate_prefix}{template}{_cond}{core.oc_times_tag}{op_cond_str}{hp_cond} {_target}{core.on_field_str}{demerit_suffix}".strip().replace(
            "  ", " "
        )
        if "{val}" in res:
            res = res.replace("{val}", str(val0))
        return res
    val_str = fmt_val_range(val0, val9, divisor, is_pct)
    param_add_val = core.sv0.get("ParamAddValue")
    ratio_hp_low = core.sv0.get("RatioHPLow")
    ratio_hp_high = core.sv0.get("RatioHPHigh")
    if ratio_hp_low is not None:
        low0 = core.sv0.get("RatioHPLow", 0)
        low9 = core.sv9.get("RatioHPLow", 0)
        min_v0 = val0 or 0
        min_v9 = val9 or 0
        max_v0 = min_v0 + low0
        max_v9 = min_v9 + low9
        if min_v0 == min_v9 and max_v0 == max_v9:
            min_str = fmt_val_range(min_v0, min_v0, divisor, is_pct).rstrip("%")
            max_str = fmt_val_range(max_v0, max_v0, divisor, is_pct)
            val_str = f"{min_str}-{max_str} <effect increases when HP is low>"
        else:
            min_str = fmt_val_range(min_v0, min_v9, divisor, is_pct).rstrip("%")
            max_str = fmt_val_range(max_v0, max_v9, divisor, is_pct)
            val_str = f"{min_str} to {max_str} <effect increases when HP is low>"
    elif ratio_hp_high is not None:
        high0 = core.sv0.get("RatioHPHigh", 0)
        high9 = core.sv9.get("RatioHPHigh", 0)
        min_v0 = val0 or 0
        min_v9 = val9 or 0
        max_v0 = min_v0 + high0
        max_v9 = min_v9 + high9
        if min_v0 == min_v9 and max_v0 == max_v9:
            min_str = fmt_val_range(min_v0, min_v0, divisor, is_pct).rstrip("%")
            max_str = fmt_val_range(max_v0, max_v0, divisor, is_pct)
            val_str = f"{min_str}-{max_str} <effect increases when HP is high>"
        else:
            min_str = fmt_val_range(min_v0, min_v9, divisor, is_pct).rstrip("%")
            max_str = fmt_val_range(max_v0, max_v9, divisor, is_pct)
            val_str = f"{min_str} to {max_str} <effect increases when HP is high>"
    elif param_add_val is not None:
        param_val0 = core.sv0.get("ParamAddValue", 0)
        param_val9 = core.sv9.get("ParamAddValue", 0)
        param_val_str = fmt_val_range(param_val0, param_val9, divisor, is_pct)
        max_count = core.sv0.get("ParamAddMaxCount")
        max_count_str = f" (Max {max_count})" if max_count else ""

        param_traits = []
        for key in ("ParamAddSelfIndividuality", "ParamAddOpIndividuality"):
            raw_traits = core.sv0.get(key, [])
            for tid in raw_traits:
                if tid not in INDIVIDUALITIE_IGNORE:
                    tname = TRAIT_ID_LABELS.get(tid, str(tid))
                    if tname not in param_traits:
                        param_traits.append(tname)
        and_check_ids = [
            tid
            for grp in core.sv0.get("ParamAddOpIndividualityAndCheck", [])
            for tid in grp
            if tid > 0 and tid != 5000 and tid not in INDIVIDUALITIE_IGNORE
        ]
        if _ANIMAL_TRAIT_IDS.issubset(set(and_check_ids)):
            if "Animal" not in param_traits:
                param_traits.append("Animal")
            and_check_ids = [tid for tid in and_check_ids if tid not in _ANIMAL_TRAIT_IDS]
        for tid in and_check_ids:
            tname = TRAIT_ID_LABELS.get(tid, str(tid))
            if tname not in param_traits:
                param_traits.append(tname)
        trait_str = " and ".join(f"[{t}]" for t in param_traits) if param_traits else ""

        target_type_id = core.sv0.get("ParamAddIndividualityTargetType")
        if target_type_id == 6:
            scaling_desc = f"{param_val_str} based on the number of enemies{max_count_str}"
        elif trait_str:
            scaling_desc = f"{param_val_str} based on the number of {trait_str} states{max_count_str}"
        elif max_count:
            scaling_desc = f"{param_val_str}{max_count_str}"
        else:
            scaling_desc = param_val_str

        if val0 == 0 or val0 is None:
            val_str = scaling_desc
        else:
            val_str = f"{val_str} <increases by {scaling_desc}>"

    if "{traits}" in template:
        if buff.get("name"):
            template = template.replace("{traits}", buff["name"])
        else:
            return None

    if (
        config
        and config.get("hide_zero_val")
        and (val0 == 0 or val0 is None)
        and param_add_val is None
        and ratio_hp_low is None
        and ratio_hp_high is None
    ):
        res = f"{rate_prefix}{template.replace(' by {val}', '')}{core.cond_str}{op_cond_str}{hp_cond} {_target}{core.on_field_str}{demerit_suffix}".strip().replace(
            "  ", " "
        )
        return None if "{traits}" in res else res
    res = f"{rate_prefix}{template.format(val=val_str)}{core.cond_str}{op_cond_str}{hp_cond} {_target}{core.on_field_str}{demerit_suffix}".strip().replace(
        "  ", " "
    )
    return None if "{traits}" in res else res


def _handle_buff_type(core):
    """Handle buff-type dispatch via BUFF_TYPE_MAP."""
    buff = core.fn.get("buffs", [])[0]
    buff_type_str = buff["type"]
    if buff_type_str == "addIndividuality":
        if not buff.get("name") and not core.sv0.get("Value") and not [v for v in buff.get("vals", []) if v.get("id") not in (3004, 3005)]:
            return None
    if buff_type_str == "donotAct" and {3066, 3076}.issubset(
        {v.get("id") for v in buff.get("vals", [])}
    ):
        bname = JP_BUFF_NAME_MAP.get(buff.get("name", ""), buff.get("name", ""))
        rate_prefix = f"{fmt_val_range(core.sv0.get('Rate', 1000), core.sv9.get('Rate', 1000), 10, False)}% Chance to "
        return (
            f"{rate_prefix}Apply [{bname}] "
            f"<nullify Resistance, unable to remove, unable to select Sacrifice, unable to Order Change>"
            f"{core.cond_str} {core.target}"
        )
    if buff_type_str in BUFF_TYPE_MAP:
        entry = BUFF_TYPE_MAP[buff_type_str]
    elif core.func_type in BUFF_TYPE_MAP:
        entry = BUFF_TYPE_MAP[core.func_type]
    else:
        return f"[unknown buff type: {buff_type_str}] {core.target}"

    template = entry.template
    if template == "NONE":
        return None
    divisor = entry.divisor
    is_pct = entry.is_pct
    config = entry.config

    if config:
        if config.get("check_show_state") and core.sv0.get("ShowState", 0) != 1:
            return None
        if config.get("special_handler") == "tdTypeChange":
            return _handle_td_type_change(core, buff)
        if config.get("special_handler") == "skillRankUp":
            return _handle_skill_rank_up(core, buff)
        if config.get("special_handler") == "overwriteClassRelation":
            return _handle_overwrite_class_relation(core, buff)
        if config.get("special_handler") == "multiattack":
            return _handle_multiattack(core, buff)
        if config.get("special_handler") == "overwriteSvtCardType":
            return _handle_overwrite_svt_card_type(core, buff)
        if config.get("special_handler") == "buffConvert":
            return _handle_buff_convert(core, buff)
        if config.get("special_handler") == "deadFunction":
            return _handle_dead_function(core, buff)
        if config.get("special_handler") == "functionedFunction":
            return _handle_functioned_function(core, buff)
        if config.get("special_handler") == "multiGutsBeforeFunction":
            return _handle_multi_guts_before(core, buff)
        if config.get("special_handler") == "treasureDevicePostAfterFunction":
            return _handle_td_post_after(core, buff)
        if config.get("special_handler") == "battlePointTrigger":
            return _handle_battle_point_trigger(core, buff)
        if config.get("special_handler") == "counterFunction":
            return _handle_counter_function(core, buff)
        if config.get("special_handler") == "reflectionFunction":
            return _handle_reflection_function(core, buff)
        if config.get("special_handler") == "shortenSkillAfterUseSkill":
            return _handle_shorten_skill_after_use(core, buff)
        template, divisor, is_pct = _resolve_traits_from_config(
            core, buff, config, template, divisor, is_pct
        )

    hp_cond = fmt_hp_cond(buff)
    return _render_buff_template(
        core, buff, buff_type_str, entry, template, divisor, is_pct, config, hp_cond
    )


# ---------------------------------------------------------------------------
# Effect-type handlers — remaining func types (no buff)
# ---------------------------------------------------------------------------


def _handle_shorten_buffcount(core):
    """Handle the shortenBuffcount func type."""
    counter = (core.ctx.counter_name if core.ctx else None) or "Counter"
    val = core.sv0.get("Value", 1)
    return f"Decrease {counter} by {val} {core.target}{' [Demerit]' if is_demerit(core.fn) else ''}"


def _handle_sub_state(core):
    """Handle the subState func type (with traitVals)."""
    if core.sv0.get("HideNoEffect") == 1:
        return None
    traits = core.fn.get("traitVals", [])
    if traits:
        labels = []
        for t in traits:
            if t.get("id", 0) >= 10000:
                continue
            label = TRAIT_ID_LABELS.get(t["id"], fmt_trait_name(t))
            if label == "Debuff" or t.get("id", 0) >= 3000:
                labels.append(label)
            else:
                labels.append(f"[{label}]")
        if not labels:
            return None
        v2_0 = core.sv0.get("Value2")
        v2_9 = core.sv9.get("Value2")
        count_prefix = (
            f"{fmt_val_range(v2_0, v2_9, 1, False)} " if v2_0 and v2_0 > 0 else ""
        )
        return f"Remove {count_prefix}{' '.join(labels)}{core.cond_str} {core.target}"
    return None


def _handle_transform_servant(core):
    """Handle the transformServant func type."""
    asc = core.sv0.get("SetLimitCount")
    if asc:
        return (
            f"Transform to {ASC_ORD.get(str(asc), f'{asc}th')} Ascension {core.target}"
        )
    svt_id = core.sv0.get("Value")
    if svt_id:
        target_name = TRAIT_ID_LABELS.get(svt_id)
        if not target_name and core.ctx and core.ctx.fetch:
            try:
                svt_data = core.ctx.fetch(svt_id)
                if svt_data:
                    target_name = svt_data.get("name")
            except Exception:
                pass
        if target_name:
            return f"Transform into [{target_name}] {core.target}"
    return None


def _handle_gain_np_individual_sum(core):
    """Handle the gainNpIndividualSum and gainNpTargetSum func types."""
    v0, v9 = core.sv0.get("Value", 0) / 100, core.sv9.get("Value", 0) / 100
    val_str = f"{v0:g}-{v9:g}%" if v0 != v9 else f"{v0:g}%"
    val2 = core.sv0.get("Value2", 0)
    if val2 == 2:
        trait_check_target = "enemies"
    elif val2 == 1:
        trait_check_target = "allies"
    elif val2 == 3:
        trait_check_target = "allies and enemies"
    elif val2 == 4:
        trait_check_target = "allies and enemies excluding yourself"
    else:
        check_target_id = core.sv0.get("GainNpTargetPassiveIndividuality", 0)
        trait_check_target = "allies and enemies" if check_target_id == 1 else "enemies"

    trait_ids = [t.get("id") for t in core.fn.get("traitVals", [])]
    if 5000 in trait_ids:
        return f"Increase NP Gauge by {val_str} {core.target} depending on number of {trait_check_target}"

    trait_labels = [
        f"{TRAIT_ID_LABELS.get(t['id'], fmt_trait_name(t))}"
        for t in core.fn.get("traitVals", [])
    ]
    return f"Increase NP Gauge by {val_str} {core.target} according to the number of {trait_check_target} in [{' and '.join(trait_labels)}] state"


def _handle_gain_np_buff_individual_sum(core):
    """Handle the gainNpBuffIndividualSum func type."""
    v0, v9 = core.sv0.get("Value", 0) / 100, core.sv9.get("Value", 0) / 100
    val_str = f"{v0:g}-{v9:g}%" if v0 != v9 else f"{v0:g}%"
    traits = core.fn.get("traitVals", [])
    trait_ids = [t.get("id") for t in traits]
    if 2836 in trait_ids:
        return f"Increase NP Gauge by {val_str} {core.target} depending on number of enemies"
    trait_labels = [
        f"{TRAIT_ID_LABELS.get(t['id'], fmt_trait_name(t))}"
        for t in traits
    ]
    return f"Increase NP Gauge by {val_str} per [{' and '.join(trait_labels)}] state {core.target}"


def _handle_gain_hp_from_targets(core):
    """Handle the gainHpFromTargets func type."""
    sv0, sv9 = core.sv0, core.sv9
    df = sv0.get("DependFunc") or sv9.get("DependFunc") or {}
    df_vals0 = sv0.get("DependFuncVals") or {}
    df_vals9 = sv9.get("DependFuncVals") or {}

    df_target_type = df.get("funcTargetType", "")
    df_target = TARGET_LABELS.get(df_target_type, df_target_type)
    val0 = df_vals0.get("Value", 0)
    val9 = df_vals9.get("Value", 0)
    val_str = fmt_val_range(val0, val9, 1, False)
    drain_part = f"Decrease HP by {val_str} {df_target}" if df_target else ""

    hp_v0 = df_vals0.get("Value2") if "Value2" in df_vals0 else (core.val0 if core.val0 is not None else val0)
    hp_v9 = df_vals9.get("Value2") if "Value2" in df_vals9 else (core.val9 if core.val9 is not None else val9)
    hp_val_str = fmt_val_range(hp_v0, hp_v9, 1, False)
    gain_part = f"Restore HP by {hp_val_str}{core.cond_str} corresponding to the amount decreased {core.target}"
    if drain_part:
        return f"{drain_part} and {gain_part}"
    return gain_part


def _handle_extend_buffturn(core):
    """Handle the extendBuffturn func type."""
    val_str = fmt_val_range(core.val0, core.val9, 1, False)
    target_list = core.sv0.get("TargetList") or []
    traits = [TRAIT_ID_LABELS.get(t, fmt_trait_name(t)) for t in target_list]
    removable_str = "removable " if core.sv0.get("IgnoreIndivUnreleaseable") else ""
    trait_part = f"[{', '.join(traits)}] " if traits else ""
    return f"Extend duration of {removable_str}{trait_part}effects by {val_str} turns {core.target}"


def _handle_move_state(core):
    """Handle the moveState func type."""
    df = core.sv0.get("DependFunc") or core.sv9.get("DependFunc") or {}
    df_target_type = df.get("funcTargetType", "")
    from_target_map = {
        "ptOther": "from all allies excluding yourself",
        "fieldOther": "from all allies and enemies excluding yourself",
        "enemyAll": "from all enemies",
        "enemy": "from one enemy",
        "enemyOne": "from one enemy",
        "ptAll": "from all allies",
        "ptOne": "from a single ally",
    }
    from_str = from_target_map.get(
        df_target_type, f"from {TARGET_LABELS.get(df_target_type, df_target_type)}"
    )
    raw_traits = df.get("traitVals") or []
    traits = [TRAIT_ID_LABELS.get(t["id"], fmt_trait_name(t)) for t in raw_traits]
    trait_str = " and ".join(f"[{t}]" for t in traits) if traits else "states"
    is_ailment = any(t.get("id") in (3011, 3015, 3026, 3005) for t in raw_traits)
    demerit_str = " [Demerit]" if is_ailment or is_demerit(core.fn) else ""
    return f"Absorb {trait_str} {from_str} {core.target}{demerit_str}"


def _handle_extend_user_equip_skill(core):
    """Handle the extendUserEquipSkill func type (Kingprotea Alter NP)."""
    val_str = fmt_val_range(core.val0, core.val9, 1, False)
    max_num = core.sv0.get("UserEquipSkillMaxTargetNum")
    max_str = f" (Max {max_num} available skills)" if max_num else ""
    return f"Increase Master Skill cooldown by {val_str} turns{max_str} {core.target} [Demerit]"


def _handle_gain_np_from_targets(core):
    """Handle the gainNpFromTargets func type."""
    sv0, sv9 = core.sv0, core.sv9
    df = sv0.get("DependFunc") or sv9.get("DependFunc") or {}
    df_vals0 = sv0.get("DependFuncVals") or {}
    df_vals9 = sv9.get("DependFuncVals") or {}

    df_type = df.get("funcType", "")
    df_target_type = df.get("funcTargetType", "")
    df_target = TARGET_LABELS.get(df_target_type, df_target_type)

    if df_type == "delayNpturn":
        val0 = df_vals0.get("Value", 0)
        val9 = df_vals9.get("Value", 0)
        if val0 > 1 or val9 > 1:
            val_str = fmt_val_range(val0, val9, 1, False)
            drain_part = f"Decrease Charge by {val_str} {df_target}"
        else:
            drain_part = f"Decrease Charge {df_target}"
    elif df_type == "lossNp":
        val0 = df_vals0.get("Value", 0)
        val9 = df_vals9.get("Value", 0)
        val_str = fmt_val_range(val0, val9, 100, True)
        drain_part = f"Decrease NP Gauge by {val_str} {df_target}"
    elif df_type in FUNC_TYPE_NO_BUFF:
        entry = FUNC_TYPE_NO_BUFF[df_type]
        if entry.divisor == 0:
            drain_part = f"{entry.template} {df_target}"
        else:
            val0 = df_vals0.get("Value", 0)
            val9 = df_vals9.get("Value", 0)
            val_str = fmt_val_range(val0, val9, entry.divisor, entry.is_pct)
            drain_part = f"{entry.template.format(val=val_str)} {df_target}"
    elif df_type:
        drain_part = f"Decrease Charge {df_target}"
    else:
        drain_part = ""

    np_v0 = df_vals0.get("Value2") if "Value2" in df_vals0 else (core.val0 if core.val0 is not None else df_vals0.get("Value"))
    np_v9 = df_vals9.get("Value2") if "Value2" in df_vals9 else (core.val9 if core.val9 is not None else df_vals9.get("Value"))
    np_val_str = fmt_val_range(np_v0, np_v9, 100, True)
    gain_part = f"Increase NP Gauge by {np_val_str}{core.cond_str} corresponding to the amount decreased {core.target}"

    if drain_part:
        return f"{drain_part} and {gain_part}"
    return gain_part


def _handle_gain_np_criticalstar_sum(core):
    """Handle the gainNpCriticalstarSum func type."""
    v0, v9 = core.sv0.get("Value", 0) / 100, core.sv9.get("Value", 0) / 100
    val_str = f"{v0:g}-{v9:g}%" if v0 != v9 else f"{v0:g}%"
    max_stars = core.sv0.get("Value2", 50)
    return f"Consume up to {max_stars} Critical Stars to Increase NP Gauge by {val_str} per Critical Star consumed{core.cond_str} {core.target}"


def _handle_func_type_no_buff(core):
    """Handle func types that don't have buffs (FUNC_TYPE_NO_BUFF lookup)."""
    if (
        core.func_type in ("lossHp", "lossHpSafe", "lossHpPerSafe")
        and core.val0 == 0
        and core.val9 == 0
        and core.sv0.get("ParamAddValue") is None
    ):
        return None
    entry = FUNC_TYPE_NO_BUFF[core.func_type]
    template, divisor, is_pct = entry.template, entry.divisor, entry.is_pct
    if core.func_type == "forceInstantDeath" and any(
        t.get("id") == 3139
        for t in (core.fn.get("script") or {}).get("funcIndividuality", [])
    ):
        template = "Apply Death <Ignore Guts>"
    use_rate = entry.use_rate
    demerit_suffix = " [Demerit]" if is_demerit(core.fn) else ""
    if core.func_type == "shortenSkill":
        val_str = fmt_val_range(core.val0, core.val9, 1, False)
        v2 = core.sv0.get("Value2")
        slot_str = f" of Skill {v2}" if v2 else ""
        return f"Reduce cooldown{slot_str} by {val_str} turns{core.cond_str} {core.target}{core.on_field_str}{demerit_suffix}"
    if divisor == 0:
        return (
            f"{template}{core.cond_str}"
            if core.func_type in {"cardReset", "lossStar"}
            else f"{template}{core.cond_str} {core.target}{core.on_field_str}{demerit_suffix}"
        )
    val_str = fmt_val_range(
        core.sv0.get("Rate") if use_rate else core.val0,
        core.sv9.get("Rate") if use_rate else core.val9,
        divisor,
        is_pct,
    )
    return f"{template.format(val=val_str)}{core.cond_str} {core.target}{core.on_field_str}{demerit_suffix}"


# ---------------------------------------------------------------------------
# Thin dispatcher
# ---------------------------------------------------------------------------


def _fmt_function_core(fn, sv_start=None, sv_end=None, ctx=None) -> str | None:
    core = _resolve_core_context(fn, sv_start, sv_end, ctx)
    if core is None:
        return None

    if core.func_type == "displayBuffstring" and "CheckOverChargeStageRange" in core.sv0:
        return f"Increase Master Affection Gauge <effect increases with Overcharge> {core.target}"
    if core.func_type == "addStateShortUserEquipSkillAvailable":
        val_str = fmt_val_range(core.val0, core.val9, 10, True)
        max_count = core.sv0.get("ParamAddMaxCount")
        max_str = f" (Max {max_count})" if max_count else ""
        return f"Increase NP Strength by {val_str} per Master Skill drained{max_str}{core.cond_str} {core.target}"
    if core.func_type == "gainStar":
        return _handle_gain_star(core)
    if core.func_type == "gainMultiplyNp":
        return _handle_gain_multiply_np(core)
    if core.func_type == "subBattlePoint":
        return _handle_sub_battle_point(core)
    if core.func_type == "addBattlePoint":
        return _handle_add_battle_point(core)

    buffs = core.fn.get("buffs", [])
    if buffs:
        buff = buffs[0]
        if buff["type"] in TRIGGER_INFO:
            return fmt_trigger_function(core.fn, core.svals, ctx=core.ctx)
        if buff["type"] == "delayFunction":
            if core.sv0.get("ActSelectIndex") is not None:
                return None
            return fmt_delay_fn(core.fn, ctx=core.ctx)
        if buff["type"] == "selfturnendFunction":
            return _handle_selfturnend(core)
        return _handle_buff_type(core)

    if core.func_type == "shortenBuffcount":
        return _handle_shorten_buffcount(core)
    if core.func_type == "subState":
        if core.fn.get("traitVals"):
            return _handle_sub_state(core)
    if core.func_type == "transformServant":
        result = _handle_transform_servant(core)
        if result is not None:
            return result
    if core.func_type in ("gainNpIndividualSum", "gainNpTargetSum"):
        return _handle_gain_np_individual_sum(core)
    if core.func_type == "gainNpBuffIndividualSum":
        return _handle_gain_np_buff_individual_sum(core)
    if core.func_type == "gainNpFromTargets":
        return _handle_gain_np_from_targets(core)
    if core.func_type == "gainHpFromTargets":
        return _handle_gain_hp_from_targets(core)
    if core.func_type == "extendBuffturn":
        return _handle_extend_buffturn(core)
    if core.func_type == "moveState":
        return _handle_move_state(core)
    if core.func_type == "extendUserEquipSkill":
        return _handle_extend_user_equip_skill(core)
    if core.func_type == "gainNpCriticalstarSum":
        return _handle_gain_np_criticalstar_sum(core)
    if core.func_type in FUNC_TYPE_NO_BUFF:
        return _handle_func_type_no_buff(core)

    return (
        f"[unknown func type: {core.func_type} (id: {core.fn['funcId']})] {core.target}"
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

_RATE_PREFIX_EXEMPT_BUFFS = {"donotAct", "selfturnendFunction", "selfturnstartFunction"}


def fmt_function(fn, sv_start=None, sv_end=None, ctx=None) -> str | None:
    result = _fmt_function_core(fn, sv_start, sv_end, ctx=ctx)
    if result is None:
        return None
    svals = fn.get("svals") or [{}]
    sv0 = sv_start if sv_start is not None else (svals[0] if svals else {})
    sv9 = sv_end if sv_end is not None else (svals[-1] if svals else {})
    hp_range = sv0.get("TriggeredTargetHpRateRange")
    if hp_range:
        result = f"When HP is below {int(hp_range[1:]) // 10}%, {result}"
    star_higher = sv0.get("StarHigher")
    if star_higher is not None:
        result = f"When Critical Stars are {star_higher} or more, {result}"
    star_lower = sv0.get("StarLower")
    if star_lower is not None:
        result = f"When Critical Stars are {star_lower} or less, {result}"
    bp_phase_ranges = sv0.get("CheckBattlePointPhaseRange")
    if bp_phase_ranges:
        rng = (bp_phase_ranges[0].get("range") or [""])[0]
        if rng.endswith("<="):
            result = f"When Master Affection Level is {rng[:-2]} or higher, {result}"
    buff_type = ((fn.get("buffs") or [{}])[0]).get("type", "")
    rate0, rate9 = sv0.get("Rate", 1000), sv9.get("Rate", 1000)
    if (
        abs(rate0) < 1000
        or abs(rate9) < 1000
        or (rate0 != rate9 and abs(rate0) != 5000 and abs(rate9) != 5000)
    ):
        if not (
            fn.get("funcType", "") == "instantDeath"
            or buff_type in _RATE_PREFIX_EXEMPT_BUFFS
        ):
            abs_rate0 = abs(rate0)
            abs_rate9 = abs(rate9)
            result = f"{fmt_val_range(abs_rate0, abs_rate9, 10, False)}% Chance to {result}"
    elif (
        ("UseRate" in sv0 or "UseRate" in sv9)
        and buff_type not in TRIGGER_INFO
        and buff_type not in _RATE_PREFIX_EXEMPT_BUFFS
    ):
        ur0, ur9 = sv0.get("UseRate", 1000), sv9.get("UseRate", 1000)
        if ur0 < 1000 or ur9 < 1000:
            result = f"{fmt_val_range(abs(ur0), abs(ur9), 10, False)}% Chance to {result}"
    func_type = fn.get("funcType", "")
    sv_trigger_pos = sv0.get("TriggeredFuncPosition")
    if sv_trigger_pos is not None or "DisplayLastFuncInvalidType" in sv0:
        if func_type in ("gainNp", "gainStar", "addState", "addStateShort", "hastenNpturn"):
            trig_prefix = _get_trigger_prefix(sv0, ctx=ctx)
            if trig_prefix:
                lowered = (
                    result[0].lower() + result[1:]
                    if (
                        result
                        and result[0].isalpha()
                        and not (len(result) > 1 and result[1].isupper())
                    )
                    else result
                )
                result = f"{trig_prefix}{lowered}"
    tvals = fn.get("functvals", [])
    if tvals:
        if fn.get("funcTargetType", "") in (
            "self",
            "selfOnly",
        ):
            traits = []
            for t in tvals:
                prefix = "not " if t.get("negative") else ""
                label = TRAIT_ID_LABELS.get(t["id"], fmt_trait_name(t))
                traits.append(f"{prefix}[{label}]")

            if len(traits) > 2:
                joined = ", ".join(traits[:-1]) + f" or {traits[-1]}"
            else:
                joined = " or ".join(traits)
            result = f"If {joined}, {result}"
    return result


def fmt_function_stacked(fn, count, ctx=None) -> str | None:
    svals = fn.get("svals") or [{}]
    sv0, sv9 = svals[0], svals[-1]
    buff = (fn.get("buffs") or [{}])[0]
    target = TARGET_LABELS.get(
        fn.get("funcTargetType", ""), fn.get("funcTargetType", "")
    )
    cond_str = fmt_condition(sv0.get("Turn", -1), sv0.get("Count", -1))
    cond_str = f" {cond_str}" if cond_str else ""
    if (
        buff.get("type") == "downTolerance"
        and buff.get("ckOpIndv")
        and buff.get("vals")
    ):
        state_name = TRAIT_ID_LABELS.get(
            buff["vals"][0]["id"], fmt_trait_name(buff["vals"][0])
        )
        traits = (
            " with " if buff.get("script", {}).get("checkIndvType") == 1 else " and "
        ).join(fmt_trait_name(t) for t in buff["ckOpIndv"])
        return f"Apply {count} [{state_name}]<Decrease {traits} Resist by {fmt_val_range(sv0.get('Value', 0), sv9.get('Value', 0), 10, True)}>{cond_str} {target}"
    base_res = fmt_function(fn, ctx=ctx)
    if not base_res:
        return None
    if count > 1:
        if base_res.startswith("Apply "):
            return f"Apply {count} " + base_res[len("Apply ") :]
        if ", Apply " in base_res:
            return base_res.replace(", Apply ", f", Apply {count} ", 1)
        return f"{base_res} (x{count})"
    return base_res
