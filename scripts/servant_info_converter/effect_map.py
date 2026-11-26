# Effect name mappings for Atlas Academy API data.
# Lookup strategy:
#   BUFF_TYPE_MAP  — keyed by buff.type string (covers any buff.id of that type)
# Note: funcs with funcTargetTeam="enemy" are already skipped in fmt_function — no need to list here.

from collections import namedtuple

FuncTypeEntry = namedtuple(
    "FuncTypeEntry", ["template", "divisor", "is_pct", "use_rate"]
)
FuncTypeEntry.__new__.__defaults__ = (False,)

BuffTypeEntry = namedtuple("BuffTypeEntry", ["template", "divisor", "is_pct", "config"])
BuffTypeEntry.__new__.__defaults__ = ({},)

# funcType string (no buff) -> FuncTypeEntry
# divisor=0 means no value displayed
# use_rate=True means use Rate field instead of Value field
# gainStar omitted — dedicated handler in fmt_function
FUNC_TYPE_NO_BUFF = {
    "cardReset": FuncTypeEntry("Redistribute Command Cards", 0, False),
    "delayNpturn": FuncTypeEntry("Decrease Charge", 0, False),
    "hastenNpturn": FuncTypeEntry("Increase Charge", 0, False),
    "gainHp": FuncTypeEntry("Restore HP by {val}", 1, False),
    "gainHpPer": FuncTypeEntry("Restore HP by {val}", 10, True),
    "gainNp": FuncTypeEntry("Increase NP Gauge by {val}", 100, True),
    "gainNpFromTargets": FuncTypeEntry("Increase NP Gauge", 0, False),
    "gainNpIndividualSum": FuncTypeEntry(
        "Increase NP Gauge according to traits", 0, False
    ),
    "instantDeath": FuncTypeEntry("{val}% chance to Inflict Death", 10, False, True),
    "forceInstantDeath": FuncTypeEntry("Apply Death", 0, False),
    "lossHp": FuncTypeEntry("Reduce HP by {val}", 1, False),
    "lossHpSafe": FuncTypeEntry("Decrease HP by {val}", 1, False),
    "lossHpPerSafe": FuncTypeEntry("Decrease HP by {val}", 10, True),
    "lossNp": FuncTypeEntry("Decrease NP Gauge by {val}", 100, True),
    "lossStar": FuncTypeEntry("Expend {val} Critical Stars", 1, False),
    "shortenSkill": FuncTypeEntry("Reduce skill cooldown by {val}", 1, False),
    "subState": FuncTypeEntry("Remove Debuffs", 0, False),
    "transformServant": FuncTypeEntry("Transform into a different form", 0, False),
}

# buff.type string -> BuffTypeEntry
# Covers every buff.id that shares this type with the same display output.
# Excludes types that need per-id or per-card special logic:
#   upDamage/upDamageIndividuality — ckOpIndv trait conditions, handled in code
#   avoidState        — dynamic handler: ckOpIndv trait -> "{trait} Immune"
#   reduceHp          — dynamic name from vals (same ignore set as donotAct)
#   selfturnendFunction/donotAct — special trigger logic in code
BUFF_TYPE_MAP = {
    # ATK / DEF
    "multiattack": BuffTypeEntry(
        "Double the number of hits of normal attacks (strength greatly decreases for each hit, but overall damage increases by {val})",
        1,
        False,
        {"special_handler": "multiattack"},
    ),
    "downDefence": BuffTypeEntry("Decrease DEF by {val}", 10, True),
    "downDefencecommandall": BuffTypeEntry(
        "Decrease Card resistance by {val}", 10, True
    ),
    "downDefenceCriticaldamage": BuffTypeEntry(
        "Decrease Critical Resistance by {val}", 10, True
    ),
    "upAtk": BuffTypeEntry(
        "Increase ATK by {val}",
        10,
        True,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Increase ATK against {traits} by {val}",
        },
    ),
    "downAtk": BuffTypeEntry("Decrease ATK by {val}", 10, True),
    "upDefence": BuffTypeEntry(
        "Increase DEF by {val}",
        10,
        True,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Apply Special Defense {traits} by {val}",
        },
    ),
    "upDamage": BuffTypeEntry(
        "Increase Damage by {val}",
        1,
        False,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Apply Special Attack {traits} by {val}",
            "divisor": 10,
            "is_percent": True,
        },
    ),
    "upDamageIndividuality": BuffTypeEntry(
        "Increase Damage by {val}",
        1,
        False,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Apply Special Attack {traits} by {val}",
            "divisor": 10,
            "is_percent": True,
        },
    ),
    "upDamageIndividualityActiveonly": BuffTypeEntry(
        "Increase Damage by {val}",
        1,
        False,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Apply Special Attack {traits} by {val}",
            "divisor": 10,
            "is_percent": True,
        },
    ),
    # NP
    "regainNp": BuffTypeEntry("Increase NP Gauge each turn by {val}", 100, True),
    "downNpturnval": BuffTypeEntry(
        "Apply a state where Charge is decreased by {val} each turn", 1, False
    ),
    "upChagetd": BuffTypeEntry(
        "Increase NP Charge by {val} levels when using NP", 1, False
    ),
    "upDamagedropnp": BuffTypeEntry(
        "Increase NP Gain when damaged by {val} when damaged", 10, True
    ),
    "upDropnp": BuffTypeEntry("Increase NP Gain by {val}", 10, True),
    "downDropnp": BuffTypeEntry("Decrease NP Gain by {val}", 10, True),
    "upNpdamage": BuffTypeEntry("Increase NP Strength by {val}", 10, True),
    "downNpdamage": BuffTypeEntry("Decrease NP Strength by {val}", 10, True),
    "upDefenceNpdamage": BuffTypeEntry("Increase NP Resistance by {val}", 10, True),
    "downDefenceNpdamage": BuffTypeEntry("Decrease NP Resistance by {val}", 10, True),
    "buffRate": BuffTypeEntry("Apply NP Strength Up Boost by {val}", 10, True),
    # Critical
    "downCriticalpoint": BuffTypeEntry("Decrease Critical Hit Rate by {val}", 10, True),
    "downCriticalRateDamageTaken": BuffTypeEntry(
        "Increase Critical Resistance by {val}", 10, True
    ),
    "upCriticalRateDamageTaken": BuffTypeEntry(
        "Decrease Critical Resistance by {val}", 10, True
    ),
    "downCriticalrate": BuffTypeEntry("Decrease Critical Rate by {val}", 10, True),
    "downCriticalStarDamageTaken": BuffTypeEntry(
        "Decrease Critical Star Gen Taken by {val}", 10, True
    ),
    "upCriticaldamage": BuffTypeEntry("Increase Critical Strength by {val}", 10, True),
    "downCriticaldamage": BuffTypeEntry("Decrease Critical Strength by {val}", 10, True),
    "upCriticalpoint": BuffTypeEntry(
        "Increase Critical Star Drop Rate by {val}", 10, True
    ),
    "upCriticalrate": BuffTypeEntry("Increase Critical Rate by {val}", 10, True),
    "upStarweight": BuffTypeEntry(
        "Increase Critical Star Gather Rate by {val}", 10, True
    ),
    "downStarweight": BuffTypeEntry(
        "Decrease Critical Star Gather Rate by {val}", 10, True
    ),
    # Card Performance
    "donotSelectCommandcard": BuffTypeEntry(
        "Apply a state where a Command Card becomes unselectable", 0, False
    ),
    "donotActCommandtype": BuffTypeEntry("Inflict Card Seal", 0, False),
    "upCommandall": BuffTypeEntry(
        "Increase Card effectiveness by {val}", 10, True
    ),
    "upDefencecommandall": BuffTypeEntry(
        "Increase Card resistance by {val}", 10, True
    ),
    "upSpecialdefence": BuffTypeEntry(
        "Increase Special Defense by {val}", 10, True
    ),
    "upCommandatk": BuffTypeEntry(
        "Increase Card Strength by {val}", 10, True
    ),
    "downCommandatk": BuffTypeEntry(
        "Decrease Card Strength by {val}", 10, True
    ),
    "overwriteSvtCardType": BuffTypeEntry(
        None, 0, False, {"special_handler": "overwriteSvtCardType"}
    ),
    # NP Card Type Change
    "tdTypeChange": BuffTypeEntry(None, 0, False, {"special_handler": "tdTypeChange"}),
    "tdTypeChangeArts": BuffTypeEntry(
        None, 0, False, {"special_handler": "tdTypeChange"}
    ),
    "tdTypeChangeBuster": BuffTypeEntry(
        None, 0, False, {"special_handler": "tdTypeChange"}
    ),
    "tdTypeChangeQuick": BuffTypeEntry(
        None, 0, False, {"special_handler": "tdTypeChange"}
    ),
    # Debuff / Resist / Immunity
    "downTolerance": BuffTypeEntry(
        "Decrease Debuff Resist by {val}",
        10,
        True,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Decrease {traits} Resist by {val}",
            "brackets": False,
            "special_cases": {
                3004: "Increase Buff Success Rate when receiving a Buff by {val}"
            },
        },
    ),
    "donotNoble": BuffTypeEntry("Inflict NP Seal", 0, False),
    "donotNobleCondMismatch": BuffTypeEntry("NONE", 0, False),
    "donotReplace": BuffTypeEntry("Disable Order Change", 0, False),
    "donotSkill": BuffTypeEntry("Inflict Skill Seal", 0, False),
    "donotSkillSelect": BuffTypeEntry("Seal Skill {val}", 0, False),
    "continueFunction": BuffTypeEntry("NONE", 0, False),
    "upGrantstate": BuffTypeEntry(
        "Increase Debuff Success Rate by {val}",
        10,
        True,
        {
            "trait_source": "ckSelfIndv",
            "trait_template": "Increase {traits} Success Rate by {val}",
            "brackets": False,
            "join_sep": " / ",
        },
    ),
    "downGrantstate": BuffTypeEntry(
        "Decrease Debuff Success Rate by {val}",
        10,
        True,
        {
            "trait_source": "ckSelfIndv",
            "trait_template": "Decrease {traits} Success Rate by {val}",
            "brackets": False,
            "join_sep": " / ",
        },
    ),
    "upTolerance": BuffTypeEntry(
        "Increase Debuff Resist by {val}",
        10,
        True,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Increase {traits} Resist by {val}",
            "brackets": False,
        },
    ),
    "upToleranceSubstate": BuffTypeEntry(
        "Increase Buff Removal Resist by {val}", 10, True
    ),
    "donotAct": BuffTypeEntry(
        "Inflict {traits}",
        0,
        False,
        {
            "trait_source": "vals_ailment",
            "use_rate_prefix": True,
            "target_override": "inflict_target",
            "brackets": False,
        },
    ),
    # HP / Recovery
    "addDamage": BuffTypeEntry("Apply Damage Plus by {val}", 1, False),
    "addMaxhp": BuffTypeEntry("Increase Max HP by {val}", 1, False),
    "donotRecovery": BuffTypeEntry("Disable HP recovery", 0, False),
    "upGainHp": BuffTypeEntry("Increase HP recovery amount by {val}", 10, True),
    "upGivegainHp": BuffTypeEntry("Increase HP recovery amount given by {val}", 10, True),
    "downGainHp": BuffTypeEntry("Reduce HP recovery by {val}", 10, True),
    "reactiveDamageGainHp": BuffTypeEntry(
        "Apply Damage Absorption <restore HP by {val} of damage taken>", 10, True
    ),
    "preventDeathByDamage": BuffTypeEntry(
        "Leave 1 HP when receiving {traits} damage",
        0,
        False,
        {"trait_source": "ckOpIndv"},
    ),
    "regainHp": BuffTypeEntry("Apply Restore HP per turn by {val}", 1, False),
    "regainStar": BuffTypeEntry("Gain Critical Stars each turn by {val}", 1, False),
    "subMaxhp": BuffTypeEntry("Decrease maximum HP by {val}", 1, False),
    "reduceHp": BuffTypeEntry(
        "Inflict {traits} by {val}",
        1,
        False,
        {"trait_source": "vals_ailment", "brackets": False},
    ),
    "hpReduceToRegain": BuffTypeEntry(
        "Apply {traits} recovery",
        0,
        False,
        {
            "trait_source": "hp_reduce_indiv",
            "fallback_source": "ckSelfIndv",
            "fallback_join_sep": " / ",
        },
    ),
    "upFuncHpReduce": BuffTypeEntry(
        "Inflict {traits} by {val}",
        10,
        True,
        {"trait_source": "ckSelfIndv_hp_reduce", "brackets": False, "join_sep": " / "},
    ),
    "lastSelfturnprogressFunction": BuffTypeEntry(
        "Inflict {traits}", 0, False, {"trait_source": "vals_ailment", "brackets": False}
    ),
    "avoidance": BuffTypeEntry("Apply Evade", 0, False),
    "upGrantInstantdeath": BuffTypeEntry("Increase Death Success Rate {val}", 10, True),
    "upNonresistInstantdeath": BuffTypeEntry(
        "Decrease Death Resist by {val}", 10, True
    ),
    "avoidanceAttackDeathDamage": BuffTypeEntry("Apply Evade Death Damage", 0, False),
    "avoidInstantdeath": BuffTypeEntry("Apply Death Immune", 0, False),
    "buffConvert": BuffTypeEntry(
        None, 0, False, {"special_handler": "buffConvert"}
    ),
    "avoidState": BuffTypeEntry(
        None,
        0,
        False,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Apply {traits} Immune",
            "brackets": False,
        },
    ),
    "breakAvoidance": BuffTypeEntry("Apply Sure Hit", 0, False),
    "fixCommandcard": BuffTypeEntry(
        "Lock the entire Party's Command Card deck", 0, False
    ),
    "invincible": BuffTypeEntry("Apply Invincible", 0, False),
    "pierceDefence": BuffTypeEntry("Apply Ignore DEF", 0, False),
    "pierceInvincible": BuffTypeEntry("Apply Ignore Invincible", 0, False),
    "pierceSpecialInvincible": BuffTypeEntry(
        "Apply Ignore Anti-Enforcement DEF", 0, False
    ),
    "pierceSubdamage": BuffTypeEntry("Apply Pierce Damage Cut", 0, False),
    "specialInvincible": BuffTypeEntry(
        "Apply Anti-Enforcement DEF <disregard [Ignore Invincible] and reduce ATK damage received to 0>",
        0,
        False,
    ),
    "addSelfdamage": BuffTypeEntry(
        "Increase damage taken by {val}",
        1,
        False,
        {
            "trait_source": "ckOpIndv_negative",
            "trait_template": "Increase damage taken that excludes {traits} by {val}",
            "join_sep": ", ",
        },
    ),
    "subSelfdamage": BuffTypeEntry(
        "Apply Incoming Damage Cut by {val}",
        1,
        False,
        {
            "trait_source": "ckOpIndv_negative",
            "trait_template": "Apply Damage Cut that excludes {traits} by {val}",
            "join_sep": ", ",
        },
    ),
    "subFuncHpReduce": BuffTypeEntry(
        "Apply Damage Cut by {val}",
        1,
        False,
        {
            "trait_source": "ckSelfIndv",
            "trait_template": "Apply Damage Cut against {traits} by {val}",
            "join_sep": ", ",
        },
    ),
    "changeCommandCardType": BuffTypeEntry(
        "Change all Command Cards to {traits} type",
        0,
        False,
        {"trait_source": "card_type_value", "brackets": False},
    ),
    "overwriteClassRelation": BuffTypeEntry(
        None, 0, False, {"special_handler": "overwriteClassRelation"}
    ),
    "overwriteBattleclass": BuffTypeEntry(
        "Change Class to match one enemy's Class", 0, False
    ),
    "shortenSkillAfterUseSkill": BuffTypeEntry(
        None, 0, False, {"special_handler": "shortenSkillAfterUseSkill"}
    ),
    "addIndividuality": BuffTypeEntry(
        "Apply {traits}", 0, False, {"trait_source": "sv0_value"}
    ),
    "subIndividuality": BuffTypeEntry(
        "Remove {traits} trait", 0, False, {"trait_source": "sv0_value"}
    ),
    "fieldIndividuality": BuffTypeEntry(
        "Change field to {traits}", 0, False, {"trait_source": "sv0_value"}
    ),
    "subFieldIndividuality": BuffTypeEntry(
        "Nullify {traits} field trait", 0, False, {"trait_source": "vals_field"}
    ),
    "toFieldChangeField": BuffTypeEntry(
        "Change field to {traits}", 0, False, {"trait_source": "vals_field"}
    ),
    "addFieldChangeToField": BuffTypeEntry(
        "Change field to {traits}", 0, False, {"trait_source": "vals_field"}
    ),
    # Guts / Taunt
    "guts": BuffTypeEntry("Apply Guts by {val}", 1, False, {"hide_zero_val": True}),
    "gutsRatio": BuffTypeEntry("Apply Guts by {val}", 10, True),
    "upHate": BuffTypeEntry(
        "Apply Target Focus",
        0,
        False,
        {
            "trait_source": "ckOpIndv",
            "trait_template": "Apply Target Focus against {traits}",
        },
    ),
    # Death Resist
    "upResistInstantdeath": BuffTypeEntry("Increase Death Resist by {val}", 10, True),
    # Battle Point / Gauge
    "addMaxBattlePoint": BuffTypeEntry(
        "Increases Maximum fullness gauge by {val}", 1, False
    ),
    "masterSkillValueUp": BuffTypeEntry(
        "Increase Master Skill effectiveness by {val}", 10, True
    ),
    "avoidFunctionExecuteSelf": BuffTypeEntry(
        "Apply [Plot Armor] <nullifies Demerit effects from your skills and Noble Phantasm (excludes certain Demerit effects such as applying Death to yourself or other sacrifices)>",
        0,
        False,
    ),
    "skillRankUp": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "skillRankUp"},
    ),
    "deadFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "deadFunction"},
    ),
    "functionedFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "functionedFunction"},
    ),
    "multiGutsBeforeFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "multiGutsBeforeFunction"},
    ),
    "treasureDevicePostAfterFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "treasureDevicePostAfterFunction"},
    ),
    "fieldIndividualityChangedFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "battlePointTrigger"},
    ),
    "confirmCommandFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "battlePointTrigger"},
    ),
    "skillBeforeFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "battlePointTrigger"},
    ),
    "skillTargetedBeforeFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "battlePointTrigger"},
    ),
    "counterFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "counterFunction"},
    ),
    "reflectionFunction": BuffTypeEntry(
        None,
        0,
        False,
        config={"special_handler": "reflectionFunction"},
    ),
    "changeBgm": BuffTypeEntry("NONE", 0, False),
}


# funcTargetType string -> display label
# (no numeric IDs available for target types in the API)
TARGET_LABELS = {
    "self": "for yourself",
    "noTarget": "for yourself",
    "ptAll": "for all allies",
    "ptOne": "for a single ally",
    "ptRandom": "for one random ally",
    "ptOneHpLowestRate": "for the ally with the lowest HP percentage",
    "ptOther": "for all allies excluding yourself",
    "ptFull": "for all allies",
    "ptOtherFull": "for all allies (including sub-members) except yourself",
    "ptOneOther": "on all allies other than the one selected ally",
    "ptSelfAnotherFirst": "of the front-most single ally, excluding yourself",
    "fieldOther": "for all allies and enemies excluding yourself",
    "enemyAll": "for all enemies",
    "enemyOne": "for one enemy",
    "enemy": "for one enemy",
    "commandTypeSelfTreasureDevice": "for yourself",
}

# Target labels when an enemy-targeted delayFunction inner skill runs from the enemy's perspective
ENEMY_CASTER_TARGET_LABELS = {
    "self": "for that enemy",
    "noTarget": "for that enemy",
    "ptOne": "for one enemy",
    "ptAll": "for all enemies",
    "ptFull": "for all enemies",
    "ptOther": "for all other enemies",
    "ptOtherFull": "for all other enemies",
    "enemy": "for a single ally",
    "enemyOne": "for a single ally",
    "enemyAll": "for all allies",
    "enemyFull": "for all allies",
    "enemyOther": "for all other allies",
    "enemyOtherFull": "for all other allies",
}

# trait id -> display label (used in ckOpIndv / ckSelfIndv condition formatting)
CLASS_TRAIT_IDS = {
    100,
    101,
    102,
    103,
    104,
    105,
    106,
    107,
    108,
    109,
    110,
    111,
    113,
    114,
    115,
    116,
    117,
    118,
    119,
    120,
    121,
    122,
    123,
    124,
    125,
    126,
    129,
    132,
    133,
    135,
    136,
    137,
}

# Add new IDs here when encountering unknown trait conditions
TRAIT_ID_LABELS = {
    # Gender
    1: "Male",
    2: "Female",
    3: "Unknown",
    # Classes
    100: "Saber",
    101: "Lancer",
    102: "Archer",
    103: "Rider",
    104: "Caster",
    105: "Assassin",
    106: "Berserker",
    107: "Shielder",
    108: "Ruler",
    109: "Alter Ego",
    110: "Avenger",
    111: "Demon God Pillar",
    113: "Beast",
    114: "Beast",
    115: "Moon Cancer",
    116: "Beast",
    117: "Foreigner",
    118: "Beast",
    119: "Beast",
    120: "Pretender",
    121: "Beast",
    122: "Beast",
    123: "Beast",
    124: "Beast",
    125: "Beast",
    126: "Beast",
    129: "Beast",
    132: "Beast",
    133: "Beast",
    135: "Beast",
    136: "Beast",
    137: "Beast",
    # Attributes
    200: "Heaven Attribute",
    201: "Earth Attribute",
    202: "Human Attribute",
    203: "Star Attribute",
    204: "Beast Attribute",
    # Alignments
    300: "Lawful",
    301: "Chaotic",
    302: "Neutral",
    303: "Good",
    304: "Evil",
    305: "Balanced",
    306: "Madness",
    307: "Bride",
    308: "Summer",
    # Rarity
    400: "Zero Star Servant",
    401: "One Star Servant",
    402: "Two Star Servant",
    403: "Three Star Servant",
    404: "Four Star Servant",
    405: "Five Star Servant",
    # Servant traits
    1000: "Servants",
    1001: "Human",
    1002: "Undead",
    1110: "Serpent",
    1119: "Demon",
    1122: "Shadow Servant",
    1132: "Oni",
    1172: "Threat to Humanity",
    1177: "Fae",
    # Enemy types
    2000: "Divine",
    2001: "Humanoid",
    2002: "Dragon",
    2004: "Roman",
    2005: "Wild Beasts",
    2007: "Saberface",
    2008: "Servant excluding servants with Power of the Star",
    2009: "Riding",
    2010: "Arthur",
    2011: "Servant",
    2012: "Brynhild's Beloved",
    2018: "Undead or Demon",
    2019: "Demonic",
    2037: "Heaven or Earth Attribute Servant (excluding Pseudo-Servants and Demi-Servants)",
    # Quest field types
    2038: "Sunlight",
    2039: "Near Water",
    2040: "Divine, Demon, or Undead",
    2073: "Forest",
    2074: "Blessing of Kur",
    2075: "Saber-class Servant",
    2076: "Super Giant",
    2113: "King",
    2114: "Greek Mythology Males",
    2121: "Burning",
    2122: "Debuff",
    2191: "Charm (Female)",
    2355: "Illya",
    2356: "Feminine-Looking Servant",
    2386: "Growth",
    2387: "Infinite Growth",
    2392: "City",
    2466: "Argo-Related",
    2467: "Weakness Found",
    2613: "Death's Abyss",
    2631: "Hominidae Servant",
    2632: "Demonic Beast Servant",
    2654: "Modern Human",
    2664: "NP Damage Resistance [Growth]",
    2666: "Giant",
    2667: "Child Servant",
    2721: "Nobunaga",
    2729: "Curse",
    2730: "Void Space",
    2731: "Existence Outside the Domain",
    2732: "Near Water or Void Space",
    2733: "Shuten-Douji on Field",
    2734: "Shuten-Douji",
    2735: "Genji",
    2759: "Grudge of Vengeance",
    2780: "Who possess Spiritron Dresses",
    2781: "Mechanical",
    2795: "Round Table Knights",
    2801: "Burning Love",
    2810: "Fairy Tale Servant",
    2821: "Animal Characteristics Servant",
    2827: "Likes!",
    2828: "Heroic King",
    2829: "Millennium Castle",
    2833: "Yu Mei-ren",
    2836: "NP Charge Block",
    2837: "Valkyrie",
    2838: "Summer Mode Servant",
    2840: "Mount Liang",
    2857: "Holy Grail Possession",
    2858: "Seven Knights Servant",
    2860: "Happy Halloween",
    2872: "Manuscript Complete",
    2873: "My Fair Soldier",
    2874: "Wrath of the Enshrined Deity",
    2875: "1st or 2nd Ascension",
    2876: "3rd Ascension",
    2878: "Mid-Air",
    2879: "Cait Cú Cerpriestess on Field",
    2880: "Anger of the Spirits",
    2881: "Group Servant",
    2884: "Darkness",
    2886: "Robin Counter",
    2887: "Robin All Gone",
    2888: "Plot Armor",
    2913: "Kuonji Alice Has Skill 3",
    2914: "Buff Guts On Instant Death",
    2919: "Bunny Servant",
    2925: "Sakura Series",
    2941: "Chance-Based Guts",
    2949: "Heaven Attribute",
    2950: "Hell",
    2951: "Mark of Sin",
    2999: "Illya on Field",
    # Buff categories / ailment types (avoidState ckOpIndv + NP traitVals)
    3004: "Buff",
    3005: "Debuff",
    3006: "ATK Buffs",
    3007: "DEF Buffs",
    3008: "ATK Debuffs",
    3009: "DEF Debuffs",
    3010: "Mental Debuff",
    3011: "Poison",
    3012: "Charm",
    3013: "Immobilize",
    3014: "Stun",
    3018: "Evade and Invincible",
    3019: "Sure Hit",
    3021: "Evade",
    # Status ailments (used in damageNpIndividualSum TargetList)
    3015: "Burn",
    3022: "Invincible",
    3024: "Guts",
    3064: "Anti-Enforcement DEF",
    3025: "Skill Seal",
    3026: "Curse",
    3039: "Death Resist Down",
    3041: "Max HP Up",
    3043: "Max HP Up",
    3045: "Immobilize",
    3047: "Pigify",
    3049: "Fear",
    3052: "Confusion",
    # Servant-specific traits
    3058: "DEF Up",
    3060: "HP Recovery per Turn",
    3066: "Sleep",
    3076: "Sacrifice Block",
    3077: "Pigify",
    3080: "NP Gain per Turn",
    3081: "Critical Stars per Turn",
    3086: "Guts Block",
    3087: "Bound",
    3088: "Marking",
    3089: "Spreading Fire",
    3090: "Buff Success Rate Up",
    3091: "Blood-Soaked Prince",
    3092: "Arts Effectiveness Up",
    3093: "Buster Effectiveness Up",
    3094: "Quick Effectiveness Up",
    3096: "On Instant Death",
    3097: "On Instant Death",
    3099: "Substitute",
    3102: "Protected",
    3103: "Not Protected",
    3121: "Under the Moonlight",
    3122: "Under the Sunlight",
    3124: "Evil",
    # Card types
    4001: "Arts",
    4002: "Buster",
    4003: "Quick",
    4004: "Extra",
    4007: "NP",
    4100: "Critical",
    10000: "Excluded from Animals",
    10006: "Sheathed Stance",
    10009: "Shinsengumi",
    10010: "Elisabeth",
    10011: "Halloween",
    10026: "Underworld Flower Garden",
    10027: "Ash Sakura",
    10028: "Snake Wife NP Used",
    10030: "Evil BB",
    10039: "Past Alteration",
    10042: "Fullness Gauge",
    10047: "Thirst for death",
    10049: "Jeanne",
    10050: "Critical",
    10051: "Target Acquisition",
    10052: "Electrolytic Corrosion",
    10058: "Illya",
    304400: "Yu Mei-ren",
    500800: "Merlin",
    504500: "Altria Caster",
    600700: "Jekyll",
    600710: "Hyde",
    603500: "Yu Mei-ren",
    704700: "Altria Caster",
    2501200: "Cnoc na Riabh",
    2501400: "Normal Aoko",
    2501500: "Super Aoko",
    9943080: "Altria Caster",
    9943090: "Altria Caster",
    9945150: "Cnoc na Riabh",
    2885: "Magic Bullets",
    2911: "Normal Aoko Buff",
    505600: "François Prélati",
    505700: "Francesca Prélati",
}

# negative individuality traits with a fixed display label (instead of "not {name}")
NEGATIVE_TRAIT_LABELS = {
    2113: "Non-King",
    10000: "excluding certain Servants",
}


# upFuncHpReduce ckSelfIndv trait id -> display label
HP_REDUCE_LABELS = {
    3011: "Corroding Poison",
    3015: "Spreading Fire",
    3026: "Disastrous Curse",
}

# NP funcType string -> action_template
# Used for deal damage functions (damageNp, etc.)
NP_TYPE_MAP = {
    "damageNp": "Deal {damage_word} damage by {val_str}% <effect increases with Level> {dmg_target}",
    "damageNpPierce": "Deal {damage_word} DEF-ignoring damage by {val_str}% <effect increases with Level> {dmg_target}",
    "damageNpIndividual": "Deal {damage_word} Special Attack [{trait}] by {corr_str}% damage{oc_tag} by {val_str}% <effect increases with Level> {dmg_target}",
    "damageNpRare": "Deal {damage_word} Special Attack [{trait}] by {corr_str}% damage{oc_tag} by {val_str}% <effect increases with Level> {dmg_target}",
    "damageNpBattlePointPhase": "Deal {damage_word} damage <STR increases by {corr_str}% per Master Affection Level (Max 10, {bp_min_str}-{bp_max_str}%)> by {val_str}% <effect increases with Level> {dmg_target}",
    "damageNpStateIndividualFix": "Deal {damage_word} Special Attack [{trait}] by {corr_str}% damage{oc_tag} by {val_str}% <effect increases with Level> {dmg_target}",
    "damageNpAndOrCheckIndividuality": "Deal {damage_word} Special Attack [{trait}] by {corr_str}% damage{oc_tag} by {val_str}% <effect increases with Level> {dmg_target}",
    "damageNpIndividualSum": {
        0: "Deal {damage_word} damage <STR increases by {corr_str}% based on the number of [{trait}] states (Max {max_count}) on yourself> by {val_str}% <effect increases with Level> {dmg_target}",
        1: "Deal {damage_word} Special Attack [{trait}] damage <Special Attack damage increases by {corr_str}% with each [{trait}] status (Maximum {max_count}) on the target> by {val_str}% <effect increases with Level> {dmg_target}",
        "flat": "Deal {damage_word} Special Attack {trait} by {corr_str}% damage{oc_tag} by {val_str}% <effect increases with Level> {dmg_target}",
    },
    "damageNpHpratioLow": "Deal {damage_word} damage by {val_str}% <effect increases with Level> that gets more powerful when your HP is low (up to +{corr_str}%){oc_tag} {dmg_target}",
    "damageNpHpratioHigh": "Deal {damage_word} damage by {val_str}% <effect increases with Level> that gets more powerful when your HP is high (up to +{corr_str}%){oc_tag} {dmg_target}",
}

# BattleAssetUIAtlas select button image name -> English display label
BTN_SELECT_IMAGE_MAP = {
    "btn_select_003": "Under the Moonlight (AOE)",
    "btn_select_004": "Under the Sunlight (Single-Target)",
}

# SelectAddInfo Japanese button name -> English display label
SELECT_OPTION_LABELS = {
    "消費しない": "Do not expend",
    "10個消費する": "Expend 10 Critical Stars",
    "20個消費する": "Expend 20 Critical Stars",
    "30個消費する": "Expend 30 Critical Stars",
    "月下(全体タイプ)": "Under the Moonlight (AOE)",
    "日輪(単体タイプ)": "Under the Sunlight (Single-Target)",
    "威力アップ〔天の力〕": "STR Up (Heaven)",
    "威力アップ〔地の力〕": "STR Up (Earth)",
    "威力アップ〔人の力〕": "STR Up (Human)",
    "入れ替えない": "Do not switch",
    "入れ替える": "Switch",
    "ガッツなし": "No Guts",
    "ガッツ50%回復": "Guts (50% HP)",
    "ガッツ1回復": "Guts (1 HP)",
    "無敵": "Invincible",
    "ガッツ": "Guts",
    "Artsアップ": "Arts Up",
    "Busterアップ": "Buster Up",
    "Quickアップ": "Quick Up",
    "クリティカル威力アップ": "Critical STR Up",
    "宝具威力アップ": "NP STR Up",
    "単体化しない": "Do not change to Single-Target",
    "単体化する": "Change to Single-Target",
    "天国化(Arts強化)": "Heaven (Arts Up)",
    "地獄化(Buster強化)": "Hell (Buster Up)",
    "通常状態": "Normal State",
    "〔冥界の花園〕状態": "Underworld Flower Garden State",
    "付与しない": "Do not apply",
    "付与する": "Apply",
}

# Japanese buff/state name -> English display label
JP_BUFF_NAME_MAP = {
    "呪い滲出": "Curse Exudation",
    "自焼": "Self-Burn",
    "納刀体勢": "Sheathed Stance",
    "特性付与〔新選組〕": "Shinsengumi",
    "特性付与〔イリヤ〕": "Illya",
    "湖水の夢": "Lake Water Dream",
    "巨人の庇護": "Protection of the Giant",
}

# Costume / Spiritron Dress ID -> English display name
SPIRITRON_DRESS_NAME_MAP = {
    "505730": "Strange Dress",
    "800210": "Swimsuit of Everlasting Summer Ver. 03",
}
