#!/usr/bin/env python3
"""Unit and integration tests for scripts/servant_info_converter and sync_servant_info."""

import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from servant_info_converter.export_servant_info import (  # noqa: E402
    extract_saint_graphs,
    extract_skill_icons,
    build_servant_info_payload,
    build_skill_by_id,
    build_svt_by_id,
    export_all_servant_info,
)
from servant_info_converter.context import FetchContext  # noqa: E402
from servant_info_converter.effect_map import TRAIT_ID_LABELS  # noqa: E402
from servant_info_converter.function_formatter import fmt_function  # noqa: E402
from servant_info_converter.np_formatter import (  # noqa: E402
    _extract_single_np_data,
    fmt_np_function,
    format_np_structured,
)
from servant_info_converter.skill_formatter import (  # noqa: E402
    format_passives_structured,
    format_skills_structured,
)
from servant_info_converter.utils import group_and_label_items  # noqa: E402
import sync_atlas_data  # noqa: E402


def _make_standard_servant():
    return {
        "id": 100100,
        "collectionNo": 2,
        "type": "normal",
        "name": "Altria Pendragon",
        "originalName": "アルトリア・ペンドラゴン",
        "className": "saber",
        "attribute": "earth",
        "rarity": 5,
        "cost": 16,
        "hpBase": 2222,
        "hpMax": 15150,
        "atkBase": 1734,
        "atkMax": 11221,
        "cards": ["1", "1", "2", "2", "3"],
        "hitsDistribution": {
            "1": [33, 67],
            "2": [100],
            "3": [50, 50],
            "4": [25, 25, 50],
        },
        "traits": [
            {"id": 2, "name": "genderFemale"},
            {"id": 100, "name": "classSaber"},
            {"id": 201, "name": "attributeEarth"},
            {"id": 300, "name": "alignmentLawful"},
            {"id": 303, "name": "alignmentGood"},
        ],
        "extraAssets": {
            "faces": {"ascension": {"1": "https://static.atlasacademy.io/JP/Faces/f_1001000.png"}},
            "charaGraph": {"ascension": {"1": "https://static.atlasacademy.io/JP/CharaGraph/100100a@1.png"}},
        },
        "skills": [
            {
                "id": 1001,
                "num": 1,
                "name": "Charisma B",
                "strengthStatus": 0,
                "coolDown": [7, 6, 5],
                "functions": [
                    {
                        "funcId": 101,
                        "funcType": "addState",
                        "funcTargetType": "ptAll",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 1, "type": "upAtk", "name": "ATK Up", "vals": []}],
                        "svals": [{"Value": 90, "Turn": 3}, {"Value": 180, "Turn": 3}],
                    }
                ],
                "skillSvts": [],
            },
            {
                "id": 1002,
                "num": 1,
                "name": "Charisma of Dragon A",
                "strengthStatus": 1,
                "coolDown": [7, 6, 5],
                "functions": [
                    {
                        "funcId": 102,
                        "funcType": "addState",
                        "funcTargetType": "ptAll",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 1, "type": "upAtk", "name": "ATK Up", "vals": []}],
                        "svals": [{"Value": 100, "Turn": 3}, {"Value": 200, "Turn": 3}],
                    }
                ],
                "skillSvts": [],
            },
            {
                "id": 2001,
                "num": 2,
                "name": "Mana Burst A",
                "strengthStatus": 0,
                "coolDown": [7, 6, 5],
                "functions": [
                    {
                        "funcId": 201,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [
                            {
                                "id": 2,
                                "type": "upCommandall",
                                "name": "Buster Up",
                                "ckSelfIndv": [{"id": 4002, "name": "cardBuster"}],
                                "vals": [],
                            }
                        ],
                        "svals": [{"Value": 300, "Turn": 1}, {"Value": 500, "Turn": 1}],
                    },
                    {
                        "funcId": 202,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [
                            {
                                "id": 202,
                                "type": "commandattackBeforeFunction",
                                "name": "Trigger",
                                "vals": [],
                            }
                        ],
                        "svals": [{"Value": 990001, "Turn": 1, "Count": 1}],
                    },
                ],
                "skillSvts": [],
            },
            {
                "id": 3001,
                "num": 3,
                "name": "Radiant Road EX",
                "strengthStatus": 0,
                "coolDown": [7, 6, 5],
                "script": {
                    "SelectAddInfo": [
                        {"btn": [{"name": "消費しない"}, {"name": "10個消費する"}]}
                    ]
                },
                "functions": [
                    {
                        "funcId": 301,
                        "funcType": "gainNp",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [],
                        "svals": [{"Value": 2000, "ActSelectIndex": 0}, {"Value": 3000, "ActSelectIndex": 0}],
                    },
                    {
                        "funcId": 302,
                        "funcType": "gainStar",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [],
                        "svals": [{"Value": 15, "ActSelectIndex": 1}, {"Value": 25, "ActSelectIndex": 1}],
                    },
                ],
                "skillSvts": [],
            },
        ],
        "noblePhantasms": [
            {
                "id": 100101,
                "num": 1,
                "name": "Excalibur",
                "card": "2",
                "strengthStatus": 0,
                "effectFlags": ["attackEnemyAll"],
                "npDistribution": [100],
                "npGain": {"buster": [86]},
                "functions": [
                    {
                        "funcId": 501,
                        "funcType": "damageNp",
                        "funcTargetType": "enemyAll",
                        "funcTargetTeam": "enemy",
                        "buffs": [],
                        "svals": [{"Value": 3000}, {"Value": 5000}],
                    }
                ],
            },
            {
                "id": 100102,
                "num": 1,
                "name": "Excalibur",
                "card": "2",
                "strengthStatus": 1,
                "effectFlags": ["attackEnemyAll"],
                "npDistribution": [100],
                "npGain": {"buster": [86]},
                "functions": [
                    {
                        "funcId": 502,
                        "funcType": "damageNp",
                        "funcTargetType": "enemyAll",
                        "funcTargetTeam": "enemy",
                        "buffs": [],
                        "svals": [{"Value": 4000}, {"Value": 6000}],
                    }
                ],
            },
        ],
        "classPassive": [
            {
                "id": 9001,
                "name": "Magic Resistance A",
                "functions": [
                    {
                        "funcId": 901,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 90, "type": "upTolerance", "name": "Debuff Resist", "vals": []}],
                        "svals": [{"Value": 200}],
                    }
                ],
            }
        ],
    }


def _make_transform_pair():
    main_svt = {
        "id": 505600,
        "collectionNo": 467,
        "type": "normal",
        "name": "François Prélati",
        "originalName": "フランソワ・プレラーティ",
        "className": "caster",
        "attribute": "human",
        "rarity": 5,
        "cost": 16,
        "hpBase": 2000,
        "hpMax": 14000,
        "atkBase": 1600,
        "atkMax": 10800,
        "cards": ["1", "1", "1", "2", "3"],
        "hitsDistribution": {"1": [33, 67], "2": [100], "3": [50, 50], "4": [25, 25, 50]},
        "traits": [
            {"id": 1, "name": "genderMale"},
            {"id": 301, "name": "alignmentChaotic"},
            {"id": 304, "name": "alignmentEvil"},
        ],
        "relateId": {"transform": [505700]},
        "skills": [
            {
                "id": 505601,
                "num": 1,
                "name": "Illusionism",
                "strengthStatus": 0,
                "coolDown": [7, 6, 5],
                "functions": [
                    {
                        "funcId": 601,
                        "funcType": "gainNp",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [],
                        "svals": [{"Value": 3000}, {"Value": 5000}],
                    }
                ],
                "skillSvts": [],
            }
        ],
        "noblePhantasms": [
            {
                "id": 505690,
                "num": 1,
                "name": "Grand Illusion",
                "card": "1",
                "strengthStatus": 0,
                "effectFlags": ["attackEnemyAll"],
                "npDistribution": [50, 50],
                "npGain": {"arts": [50]},
                "functions": [
                    {
                        "funcId": 602,
                        "funcType": "damageNp",
                        "funcTargetType": "enemyAll",
                        "funcTargetTeam": "enemy",
                        "buffs": [],
                        "svals": [{"Value": 4500}, {"Value": 7500}],
                    }
                ],
            }
        ],
        "classPassive": [
            {
                "id": 9101,
                "name": "Territory Creation",
                "functions": [
                    {
                        "funcId": 911,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [
                            {
                                "id": 91,
                                "type": "upCommandall",
                                "name": "Arts Up",
                                "ckSelfIndv": [{"id": 4001, "name": "cardArts"}],
                                "vals": [],
                            }
                        ],
                        "svals": [{"Value": 100}],
                    }
                ],
            }
        ],
    }

    trans_svt = {
        "id": 505700,
        "collectionNo": 0,
        "type": "enemyCollectionDetail",
        "name": "Francesca Prélati",
        "originalName": "フランチェスカ・プレラーティ",
        "className": "caster",
        "attribute": "earth",
        "rarity": 5,
        "cost": 16,
        "hpBase": 2000,
        "hpMax": 14000,
        "atkBase": 1600,
        "atkMax": 10800,
        "cards": ["1", "1", "2", "2", "3"],
        "hitsDistribution": {"1": [33, 67], "2": [100], "3": [50, 50], "4": [25, 25, 50]},
        "traits": [
            {"id": 2, "name": "genderFemale"},
            {"id": 301, "name": "alignmentChaotic"},
            {"id": 304, "name": "alignmentEvil"},
        ],
        "skills": [
            {
                "id": 505701,
                "num": 1,
                "name": "Chaos Phantasms",
                "strengthStatus": 0,
                "coolDown": [7, 6, 5],
                "functions": [
                    {
                        "funcId": 603,
                        "funcType": "gainStar",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [],
                        "svals": [{"Value": 10}, {"Value": 20}],
                    }
                ],
                "skillSvts": [],
            }
        ],
        "noblePhantasms": [
            {
                "id": 505790,
                "num": 1,
                "name": "Nightmare Spiral",
                "card": "2",
                "strengthStatus": 0,
                "effectFlags": ["attackEnemyAll"],
                "npDistribution": [33, 33, 34],
                "npGain": {"buster": [50]},
                "functions": [
                    {
                        "funcId": 604,
                        "funcType": "damageNp",
                        "funcTargetType": "enemyAll",
                        "funcTargetTeam": "enemy",
                        "buffs": [],
                        "svals": [{"Value": 3000}, {"Value": 5000}],
                    }
                ],
            }
        ],
        "classPassive": [
            {
                "id": 9102,
                "name": "Item Construction",
                "functions": [
                    {
                        "funcId": 912,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 92, "type": "upGrantstate", "name": "Debuff Success", "vals": []}],
                        "svals": [{"Value": 100}],
                    }
                ],
            }
        ],
    }
    return main_svt, trans_svt


def _make_mash():
    return {
        "id": 800100,
        "collectionNo": 1,
        "type": "heroine",
        "name": "Mash Kyrielight",
        "originalName": "マシュ・キリエライト",
        "className": "shielder",
        "attribute": "earth",
        "rarity": 3,
        "cost": 0,
        "hpBase": 1854,
        "hpMax": 10302,
        "atkBase": 1261,
        "atkMax": 6791,
        "cards": ["1", "1", "2", "3", "3"],
        "hitsDistribution": {"1": [50, 50], "2": [100], "3": [50, 50], "4": [33, 33, 34]},
        "traits": [
            {"id": 2, "name": "genderFemale"},
            {"id": 300, "name": "alignmentLawful"},
            {"id": 303, "name": "alignmentGood"},
        ],
        "extraAssets": {
            "faces": {
                "ascension": {"1": "https://static.atlasacademy.io/JP/Faces/f_8001000.png"},
                "costume": {
                    "800140": "https://static.atlasacademy.io/JP/Faces/f_8001400.png",
                    "800190": "https://static.atlasacademy.io/JP/Faces/f_8001900.png",
                },
            }
        },
        "ascensionAdd": {
            "attribute": {"costume": {"800190": "human"}},
            "overwriteHpBase": {"costume": {"800190": 2100}},
            "overwriteHpMax": {"costume": {"800190": 14500}},
            "overwriteAtkBase": {"costume": {"800190": 1500}},
            "overwriteAtkMax": {"costume": {"800190": 9900}},
            "overwriteRarity": {"costume": {"800190": 5}},
        },
        "script": {"SkillRankUp": {"2477350": [2477450]}},
        "skills": [
            {
                "id": 80011,
                "num": 1,
                "name": "Transient Wall of Snowflakes",
                "strengthStatus": 0,
                "coolDown": [7, 6, 5],
                "functions": [
                    {
                        "funcId": 701,
                        "funcType": "addState",
                        "funcTargetType": "ptAll",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 71, "type": "upDefence", "name": "DEF Up", "vals": []}],
                        "svals": [{"Value": 150, "Turn": 3}, {"Value": 200, "Turn": 3}],
                    }
                ],
                "skillSvts": [],
            },
            {
                "id": 2477350,
                "num": 2,
                "name": "Obscurant Wall of Chalk A",
                "strengthStatus": 0,
                "coolDown": [9, 8, 7],
                "functions": [
                    {
                        "funcId": 702,
                        "funcType": "addState",
                        "funcTargetType": "ptOne",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 72, "type": "invincible", "name": "Invincible", "vals": []}],
                        "svals": [{"Turn": 1}],
                    }
                ],
                "skillSvts": [{"svtId": 800100, "releaseConditions": [{"condType": "equipWithTargetCostume", "condNum": 19}]}],
            },
        ],
        "noblePhantasms": [
            {
                "id": 800101,
                "num": 1,
                "name": "Lord Chaldeas",
                "card": "1",
                "strengthStatus": 0,
                "effectFlags": [],
                "npDistribution": [],
                "npGain": {"arts": [84]},
                "functions": [
                    {
                        "funcId": 711,
                        "funcType": "addState",
                        "funcTargetType": "ptAll",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 73, "type": "upDefence", "name": "DEF Up", "vals": []}],
                        "svals": [{"Value": 300, "Turn": 3}],
                    }
                ],
            },
            {
                "id": 800104,
                "num": 1,
                "name": "Lord Camelot",
                "card": "1",
                "strengthStatus": 1,
                "effectFlags": [],
                "npDistribution": [],
                "npGain": {"arts": [84]},
                "functions": [
                    {
                        "funcId": 712,
                        "funcType": "addState",
                        "funcTargetType": "ptAll",
                        "funcTargetTeam": "player",
                        "buffs": [{"id": 74, "type": "upAtk", "name": "ATK Up", "vals": []}],
                        "svals": [{"Value": 300, "Turn": 3}],
                    }
                ],
            },
            {
                "id": 800107,
                "num": 1,
                "name": "Lord Chaldeas",
                "card": "1",
                "strengthStatus": 0,
                "effectFlags": [],
                "npDistribution": [],
                "npGain": {"arts": [84]},
                "script": {"tdTypeChangeIDs": [800107, 800108]},
                "functions": [],
            },
            {
                "id": 800108,
                "num": 1,
                "name": "Rayproof Kyrielight",
                "card": "2",
                "strengthStatus": 0,
                "effectFlags": ["attackEnemyAll"],
                "npDistribution": [33, 33, 34],
                "npGain": {"buster": [84]},
                "script": {"tdTypeChangeIDs": [800107, 800108]},
                "functions": [
                    {
                        "funcId": 713,
                        "funcType": "damageNp",
                        "funcTargetType": "enemyAll",
                        "funcTargetTeam": "enemy",
                        "buffs": [],
                        "svals": [{"Value": 3000}, {"Value": 5000}],
                    }
                ],
            },
        ],
        "classPassive": [],
    }


def _make_sample_skills():
    return [
        {
            "id": 990001,
            "name": "Trigger Inner",
            "functions": [
                {
                    "funcId": 9901,
                    "funcType": "gainStar",
                    "funcTargetType": "self",
                    "funcTargetTeam": "player",
                    "buffs": [],
                    "svals": [{"Value": 10}],
                }
            ],
        },
        {
            "id": 2477450,
            "name": "Timeworn Bullet Kindling of Amethyst B",
            "functions": [
                {
                    "funcId": 9902,
                    "funcType": "gainNp",
                    "funcTargetType": "self",
                    "funcTargetTeam": "player",
                    "buffs": [],
                    "svals": [{"Value": 3000}],
                }
            ],
        },
    ]


class ServantInfoConverterTests(unittest.TestCase):
    def _assert_clean_schema(self, data):
        required_top = {
            "id",
            "collectionNo",
            "name",
            "originalName",
            "className",
            "rarity",
            "cost",
            "hpBase",
            "hpMax",
            "atkBase",
            "atkMax",
            "formatted",
        }
        self.assertTrue(required_top.issubset(data.keys()))
        for forbidden in ("convertedText", "charaGraphs", "faceUrl", "borderedFaceUrl"):
            self.assertNotIn(forbidden, data)

        serialized = json.dumps(data, ensure_ascii=False)
        self.assertNotIn("https://", serialized)
        self.assertNotIn("http://", serialized)
        self.assertNotIn("convertedText", serialized)
        self.assertNotIn("faceUrl", serialized)
        self.assertNotIn("borderedFaceUrl", serialized)

        fmt = data["formatted"]
        self.assertIn("profile", fmt)
        self.assertIn("slots", fmt)
        self.assertIn("formConfig", fmt)
        for dup_key in ("skills", "noblePhantasms", "passives", "appendSkills"):
            self.assertNotIn(dup_key, fmt)
        self.assertIsInstance(fmt["profile"]["forms"], list)
        self.assertGreater(len(fmt["profile"]["forms"]), 0)
        for slot in fmt["slots"]:
            self.assertIn("slotKey", slot)
            self.assertIn("type", slot)
            self.assertIn("tiers", slot)
            self.assertIn("maxTier", slot)
            self.assertIn("activeTier", slot)
            self.assertIn("variantsByTier", slot)

    def test_standard_servant_multi_tier_skills_np_passives(self):
        svt = _make_standard_servant()
        skills = _make_sample_skills()
        svt_by_id = build_svt_by_id([svt])
        skill_by_id = build_skill_by_id([svt], skills)

        payload = build_servant_info_payload(svt, svt_by_id=svt_by_id, skill_by_id=skill_by_id)
        self._assert_clean_schema(payload)

        self.assertEqual(payload["className"], "Saber")
        self.assertEqual(payload["formatted"]["profile"]["forms"][0]["cardDeck"], "AABBQ")

        slots_by_key = {s["slotKey"]: s for s in payload["formatted"]["slots"]}
        # Skill 1 has 2 tiers (0 and 1)
        sk1 = slots_by_key["skill_1"]
        self.assertEqual(sk1["slotNum"], 1)
        self.assertEqual(sk1["tiers"], [0, 1])
        self.assertEqual(sk1["maxTier"], 1)
        self.assertEqual(sk1["activeTier"], 1)
        self.assertIn("Increase ATK by 9-18%", sk1["variantsByTier"][0]["effects"][0])
        self.assertIn("Increase ATK by 10-20%", sk1["variantsByTier"][1]["effects"][0])

        # Skill 2 resolved inner skill 990001 from skill_by_id
        sk2 = slots_by_key["skill_2"]
        self.assertTrue(any("Gain Critical Stars by 10" in eff for eff in sk2["variantsByTier"][0]["effects"]))

        # Skill 3 preserves ActSelectIndex option header
        sk3 = slots_by_key["skill_3"]
        self.assertIn("Select 2 Options", sk3["variantsByTier"][0]["effects"][0])

        # NP has 2 tiers (0 and 1)
        np1 = slots_by_key["np_1"]
        self.assertEqual(np1["tiers"], [0, 1])
        self.assertIn("300-500%", np1["variantsByTier"][0]["effects"][0])
        self.assertIn("400-600%", np1["variantsByTier"][1]["effects"][0])

        # Passives exist in formatted.slots (duplicate formatted.passives is stripped)
        self.assertIn("passive_1", slots_by_key)

    def test_transform_servant_uses_in_memory_svt_by_id(self):
        main_svt, trans_svt = _make_transform_pair()
        svt_by_id = build_svt_by_id([main_svt, trans_svt])
        payload = build_servant_info_payload(main_svt, svt_by_id=svt_by_id, skill_by_id={})
        self._assert_clean_schema(payload)

        fmt = payload["formatted"]
        self.assertTrue(fmt["profile"]["isMultiForm"])
        self.assertEqual(len(fmt["profile"]["forms"]), 2)
        self.assertEqual(fmt["profile"]["forms"][0]["cardDeck"], "AAABQ")
        self.assertEqual(fmt["profile"]["forms"][1]["cardDeck"], "AABBQ")

        # formConfig contains both forms without any faceUrl / https://
        self.assertIsNotNone(fmt["formConfig"])
        self.assertIn("0", fmt["formConfig"])
        self.assertIn("1", fmt["formConfig"])
        self.assertTrue(fmt["formConfig"]["1"]["changeName"])

        # Passives split into 2 forms because they differ
        passive_slot = next(s for s in fmt["slots"] if s["slotKey"] == "passive_1")
        passive_var = passive_slot["variantsByTier"][0]
        self.assertEqual(len(passive_var["forms"]), 2)

    def test_mash_costume_forms_and_offline_graceful_fallback(self):
        mash = _make_mash()
        skills = _make_sample_skills()
        svt_by_id = build_svt_by_id([mash])

        # Online-equivalent bulk skill dict present
        skill_by_id = build_skill_by_id([mash], skills)
        payload = build_servant_info_payload(mash, svt_by_id=svt_by_id, skill_by_id=skill_by_id)
        self._assert_clean_schema(payload)

        fmt = payload["formatted"]
        self.assertEqual(len(fmt["profile"]["forms"]), 2)
        self.assertIsNotNone(fmt["formConfig"])
        self.assertEqual(set(fmt["formConfig"].keys()), {0, 1, 2})

        slots_by_key = {s["slotKey"]: s for s in fmt["slots"]}
        sk2_forms = slots_by_key["skill_2"]["variantsByTier"][0]["forms"]
        self.assertTrue(any("[When loaded with the Holy Sword]" in eff for eff in sk2_forms[0]["effects"]))

        # Offline fallback: empty skill_by_id still formats cleanly without crashing
        offline_payload = build_servant_info_payload(mash, svt_by_id=svt_by_id, skill_by_id={})
        self._assert_clean_schema(offline_payload)

    def test_offline_missing_inner_skill_trigger_does_not_crash(self):
        svt = _make_standard_servant()
        payload = build_servant_info_payload(svt, svt_by_id={100100: svt}, skill_by_id={})
        self._assert_clean_schema(payload)
        sk2 = next(s for s in payload["formatted"]["slots"] if s["slotKey"] == "skill_2")
        self.assertTrue(len(sk2["variantsByTier"][0]["effects"]) >= 1)

    def test_payload_strips_duplicate_formatted_arrays(self):
        svt = _make_standard_servant()
        payload = build_servant_info_payload(svt, svt_by_id={100100: svt}, skill_by_id={})
        fmt = payload["formatted"]
        self.assertEqual(set(fmt.keys()), {"profile", "slots", "formConfig"})
        for dup_key in ("skills", "noblePhantasms", "passives", "appendSkills"):
            self.assertNotIn(dup_key, fmt)

    def test_export_all_writes_only_playable_servants_and_sync_integration(self):
        std = _make_standard_servant()
        main_svt, trans_svt = _make_transform_pair()
        mash = _make_mash()
        nice_servants = [std, main_svt, trans_svt, mash]
        nice_skills = _make_sample_skills()

        with tempfile.TemporaryDirectory() as tmpdir:
            res = export_all_servant_info(
                nice_servants,
                output_dir=tmpdir,
                nice_skills=nice_skills,
                name_overrides={"100100": "Altria Pendragon"},
            )
            self.assertEqual(res["exported"], 3)
            self.assertEqual(res["errors"], [])

            written_files = sorted(p.name for p in Path(tmpdir).glob("*.json"))
            self.assertEqual(written_files, ["100100.json", "505600.json", "800100.json"])
            self.assertFalse((Path(tmpdir) / "505700.json").exists())

            for fname in written_files:
                raw = (Path(tmpdir) / fname).read_text(encoding="utf-8")
                self.assertNotIn("https://", raw)
                self.assertNotIn("convertedText", raw)
                self.assertNotIn("faceUrl", raw)
                self.assertNotIn("borderedFaceUrl", raw)
                parsed = json.loads(raw)
                self._assert_clean_schema(parsed)

    def test_sync_atlas_data_servant_info_only_with_mocked_cache(self):
        std = _make_standard_servant()
        nice_servants = [std]

        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir) / "public" / "servant_info"
            cache_dir = Path(tmpdir) / ".cache" / "atlas"
            args = SimpleNamespace(
                cache_dir=str(cache_dir),
                ids=None,
                force=False,
                dry_run=False,
                servant_info_only=True,
            )

            def fake_get_cached_json(cdir, filename, url, force=False):
                if filename == "nice_servant_lore_lang_en.json":
                    return nice_servants
                raise AssertionError(f"Unexpected fetch: {filename} ({url})")

            sample_inner = _make_sample_skills()[0]

            def fake_fetch_url(url, **kwargs):
                return json.dumps(sample_inner).encode("utf-8"), None

            with (
                patch.object(sync_atlas_data, "PUBLIC_SERVANT_INFO_DIR", str(out_dir)),
                patch.object(sync_atlas_data, "PUBLIC_SAINT_GRAPHS_DIR", str(Path(tmpdir) / "public" / "saint_graphs")),
                patch.object(sync_atlas_data, "get_cached_json", side_effect=fake_get_cached_json),
                patch.object(sync_atlas_data, "fetch_url", side_effect=fake_fetch_url),
            ):
                args.skip_saint_graphs = True
                args.skip_faces = True
                args.skip_skill_icons = True
                sync_atlas_data.sync_servant_info(args)

            expected = out_dir / "100100.json"
            self.assertTrue(expected.exists())
            self.assertTrue((cache_dir / "inner_skills.json").exists())
            data = json.loads(expected.read_text(encoding="utf-8"))
            self._assert_clean_schema(data)

    def test_extract_saint_graphs(self):
        u = "https://static.atlasacademy.io/JP/CharaGraph/100100/100100%s@%s.png"
        svt = {
            "id": 100100,
            "relateId": {"transform": [100200]},
            "extraAssets": {"charaGraph": {
                "ascension": {"2": u % ("a", "2"), "1": u % ("a", "1"), "10": u % ("a", "1")},
                "costume": {"11": u % ("b", "11")},
            }},
            "profile": {"costume": {"11": {"shortName": "Summer"}}},
        }
        partner = {"id": 100200, "name": "Alt", "extraAssets": {"charaGraph": {"ascension": {"1": u % ("c", "1")}}}}
        entries, urls = extract_saint_graphs(svt, {100100: svt, 100200: partner})
        self.assertEqual(
            [(e["key"], e["label"], e["file"], e["kind"]) for e in entries],
            [
                ("1", "1st Ascension", "100100a@1.webp", "ascension"),
                ("2", "2nd Ascension", "100100a@2.webp", "ascension"),
                ("11", "Summer", "100100b@11.webp", "costume"),
                ("1", "1st Ascension", "100100c@1.webp", "form"),
            ],
        )
        self.assertEqual(len(urls), 4)
        self.assertNotIn("https://", json.dumps(entries))
        svt2 = dict(svt, id=600710, relateId={"transform": [100200]})
        self.assertNotIn("form", [e["kind"] for e in extract_saint_graphs(svt2, {100200: partner})[0]])
        svt3 = dict(svt, relateId={"transform": [600710]})
        p710 = dict(partner, id=600710)
        self.assertNotIn("form", [e["kind"] for e in extract_saint_graphs(svt3, {600710: p710})[0]])

    def test_saint_graph_special_metadata(self):
        u = "https://static.atlasacademy.io/JP/CharaGraph/%s/%sa.png"
        mash_costumes = {"800140": (12, "Ortinax"), "800151": (18, "Ortinax"), "800190": (17, "Paladin"), "800200": (19, "Paladin")}
        mash = {
            "id": 800100,
            "name": "Mash",
            "extraAssets": {"charaGraph": {"ascension": {"1": u % (800100, 800100)}, "costume": {k: u % (k, k) for k in mash_costumes}}},
            "profile": {"costume": {k: {"id": i, "shortName": n} for k, (i, n) in mash_costumes.items()}},
        }
        entries, _ = extract_saint_graphs(mash)
        self.assertEqual([e["key"] for e in entries], ["1", "800140", "800190"])
        self.assertEqual([e["form"] for e in entries], [0, 1, 2])

        mel = {
            "id": 304800,
            "name": "Melusine",
            "originalName": "M",
            "ascensionAdd": {"overWriteServantName": {"ascension": {"0": "Tam Lin"}, "costume": {"11": "Tam Lin"}}},
            "extraAssets": {"charaGraph": {"ascension": {"1": u % (304800, "a"), "4": u % (304800, "d")}, "costume": {k: u % (k, k) for k in ("304830", "304840", "304850")}}},
            "profile": {"costume": {
                "304830": {"id": 11, "shortName": "X (First Ascension)"},
                "304840": {"id": 12, "shortName": "X (Second Ascension)"},
                "304850": {"id": 13, "shortName": "Red Hot"},
            }},
            "skills": [
                {"num": 3, "releaseConditions": [{"condType": "svtLimit", "condNum": 3}]},
                {"num": 3, "releaseConditions": [{"condType": "equipWithTargetCostume", "condNum": 13}]},
            ],
        }
        entries, _ = extract_saint_graphs(mel)
        self.assertEqual([e["label"] for e in entries[:2]], ["1st Ascension", "Final Ascension"])
        self.assertEqual([e.get("ascensionStage") for e in entries], ["1", "4", "1", "2", "3"])
        self.assertEqual(entries[0]["name"], "Tam Lin")
        self.assertEqual(entries[2]["name"], "Tam Lin")
        self.assertNotIn("name", entries[3])

        hassan = {
            "id": 605300,
            "name": "Hassan-i Sabbah",
            "originalName": "ハサン",
            "ascensionAdd": {"overWriteServantName": {"ascension": {"1": "Azrael", "2": "Azrael", "3": "Sidra Azrael", "4": "Azrael the Pale"}}},
            "extraAssets": {"charaGraph": {"ascension": {str(i): u % (605300, i) for i in range(1, 5)}}},
        }
        h_entries, _ = extract_saint_graphs(hassan)
        self.assertEqual([e["label"] for e in h_entries], ["1st Ascension", "2nd Ascension", "3rd Ascension", "Final Ascension"])
        self.assertEqual([e.get("name") for e in h_entries], [None, "Azrael", "Sidra Azrael", "Azrael the Pale"])

        nobu = {
            "id": 1100700,
            "name": "Demon King Nobunaga",
            "ascensionAdd": {"overWriteServantName": {"ascension": {"0": "Oda Nobunaga", "1": "Oda Kippoushi", "2": "Oda Kippoushi"}}},
            "extraAssets": {"charaGraph": {"ascension": {str(i): u % (1100700, i) for i in range(1, 5)}}},
        }
        n_entries, _ = extract_saint_graphs(nobu)
        self.assertEqual([e.get("name") for e in n_entries], ["Oda Nobunaga", "Oda Kippoushi", None, None])

        ody = {
            "id": 403800,
            "name": "Odysseus",
            "extraAssets": {"charaGraph": {"ascension": {"1": u % (403800, 1)}, "costume": {k: u % (k, k) for k in ("403830", "403840", "403850")}}},
            "profile": {"costume": {
                "403830": {"id": 11, "shortName": "Aegis (Second Ascension)"},
                "403840": {"id": 12, "shortName": "Aegis (Third Ascension)"},
                "403850": {"id": 13, "shortName": "Sabazios"},
            }},
        }
        o_entries, _ = extract_saint_graphs(ody)
        self.assertEqual([e.get("ascensionStage") for e in o_entries], ["1", "2", "3", None])

        ody["extraAssets"]["faces"] = {
            "ascension": {"1": "https://static.atlasacademy.io/JP/Faces/f_4038000.png"},
            "costume": {
                "403830": "https://static.atlasacademy.io/JP/Faces/f_4038300.png",
                "403840": "https://static.atlasacademy.io/JP/Faces/f_4038400.png",
            },
        }
        c_entries, _ = extract_saint_graphs(ody)
        self.assertEqual([e.get("face") for e in c_entries], ["403800/000.webp", "403800/c_403830.webp", "403800/c_403840.webp", None])

        partner = {
            "id": 505700,
            "name": "Francesca Prelati",
            "originalName": "フランチェスカ・プレラーティ",
            "extraAssets": {
                "charaGraph": {
                    "ascension": {"1": u % (505700, 505700)},
                    "costume": {"505730": u % (505730, 505730)},
                },
                "faces": {
                    "ascension": {"1": "https://static.atlasacademy.io/JP/Faces/f_5057000.png"},
                    "costume": {"505730": "https://static.atlasacademy.io/JP/Faces/f_5057300.png"},
                },
            },
            "profile": {"costume": {"505730": {"id": 11, "name": "簡易霊衣：ストレンジドレス", "shortName": "ストレンジドレス"}}},
        }
        main = {
            "id": 505600,
            "relateId": {"transform": [505700]},
            "extraAssets": {
                "charaGraph": {"ascension": {"1": u % (505600, 505600)}},
                "faces": {"ascension": {"1": "https://static.atlasacademy.io/JP/Faces/f_5056000.png"}},
            },
        }
        entries, url_by_filename, face_urls, _ = extract_saint_graphs(main, {505700: partner}, include_faces=True)
        self.assertEqual(entries[0]["form"], 0)
        self.assertEqual(entries[0]["face"], "505600/000.webp")
        self.assertEqual(entries[1]["form"], 1)
        self.assertEqual(entries[1]["kind"], "form")
        self.assertEqual(entries[1]["label"], "1st Ascension")
        self.assertEqual(entries[1]["name"], "Francesca Prelati")
        self.assertEqual(entries[1]["originalName"], "フランチェスカ・プレラーティ")
        self.assertEqual(entries[1]["face"], "505700/000.webp")
        self.assertEqual(entries[2]["key"], "505730")
        self.assertEqual(entries[2]["label"], "ストレンジドレス")
        self.assertEqual(entries[2]["file"], "505730a.webp")
        self.assertEqual(entries[2]["kind"], "costume")
        self.assertEqual(entries[2]["form"], 1)
        self.assertEqual(entries[2]["name"], "Francesca Prelati")
        self.assertEqual(entries[2]["originalName"], "フランチェスカ・プレラーティ")
        self.assertEqual(entries[2]["face"], "505700/c_505730.webp")
        self.assertEqual(url_by_filename["505730a.webp"], u % (505730, 505730))
        self.assertEqual(face_urls["505700/c_505730.webp"], "https://static.atlasacademy.io/JP/Faces/f_5057300_bordered.png")
        self.assertNotIn("https://", json.dumps(entries))

    def test_flora_same_name_transform_form_config(self):
        main_svt, trans_svt = _make_transform_pair()
        flora = dict(main_svt, id=1002000, collectionNo=464, name="Flora", originalName="フローラ", relateId={"transform": [1002100]})
        flora2 = dict(trans_svt, id=1002100, collectionNo=0, name="Flora", originalName="フローラ")
        payload = build_servant_info_payload(flora, svt_by_id=build_svt_by_id([flora, flora2]), skill_by_id={})
        self._assert_clean_schema(payload)
        fc = payload["formatted"]["formConfig"]
        self.assertEqual(fc["0"]["label"], "Form 1")
        self.assertEqual(fc["1"]["label"], "Form 2")
        self.assertFalse(fc["0"]["changeName"])
        self.assertFalse(fc["1"]["changeName"])
        self.assertEqual([f["label"] for f in payload["formatted"]["profile"]["forms"]], ["Form 1", "Form 2"])

    def test_face_urls_and_hyde_form_config_faces(self):
        main_svt, trans_svt = _make_transform_pair()
        f_base = "https://static.atlasacademy.io/JP/Faces/f_%s.png"
        sg_base = "https://static.atlasacademy.io/JP/CharaGraph/%s/%sa@%s.png"
        jekyll = dict(
            main_svt,
            id=600700,
            collectionNo=81,
            name="Henry Jekyll & Hyde",
            originalName="ヘンリー・ジキル＆ハイド",
            relateId={"transform": [600710]},
            extraAssets={
                "charaGraph": {
                    "ascension": {str(i): sg_base % (600700, 600700, i) for i in range(1, 5)},
                    "costume": {"600730": sg_base % (600700, 600730, 1)},
                },
                "faces": {
                    "ascension": {str(i): f_base % f"600700{i - 1}" for i in range(1, 5)},
                    "costume": {"600730": f_base % "6007300"},
                },
            },
        )
        hyde = dict(
            trans_svt,
            id=600710,
            collectionNo=0,
            name="Henry Jekyll & Hyde",
            originalName="ヘンリー・ジキル＆ハイド",
            extraAssets={
                "charaGraph": {"ascension": {str(i): sg_base % (600710, 600710, i) for i in range(1, 5)}},
                "faces": {"ascension": {str(i): f_base % f"600710{i - 1}" for i in range(1, 5)}},
            },
        )
        svt_by_id = build_svt_by_id([jekyll, hyde])
        entries, _, face_urls, partner_faces = extract_saint_graphs(jekyll, svt_by_id, include_faces=True)

        self.assertEqual(
            [e.get("face") for e in entries],
            ["600700/000.webp", "600700/001.webp", "600700/002.webp", "600700/003.webp", "600700/c_600730.webp"],
        )
        self.assertEqual(
            partner_faces,
            {
                "1": "600710/000.webp",
                "2": "600710/001.webp",
                "3": "600710/002.webp",
                "4": "600710/003.webp",
            },
        )
        self.assertEqual(face_urls["600700/000.webp"], "https://static.atlasacademy.io/JP/Faces/f_6007000_bordered.png")
        self.assertEqual(face_urls["600700/003.webp"], "https://static.atlasacademy.io/JP/Faces/f_6007003_bordered.png")
        self.assertEqual(face_urls["600700/c_600730.webp"], "https://static.atlasacademy.io/JP/Faces/f_6007300_bordered.png")
        self.assertEqual(face_urls["600710/002.webp"], "https://static.atlasacademy.io/JP/Faces/f_6007102_bordered.png")

        payload = build_servant_info_payload(jekyll, svt_by_id=svt_by_id, skill_by_id={})
        self._assert_clean_schema(payload)
        self.assertEqual(payload["formatted"]["formConfig"]["1"]["faces"], partner_faces)

        with tempfile.TemporaryDirectory() as tmpdir:
            res = export_all_servant_info([jekyll, hyde], output_dir=tmpdir)
            self.assertEqual(res["exported"], 1)
            self.assertEqual(set(res["face_urls"].keys()), set(face_urls.keys()))

    def test_sync_servant_faces_incremental_fallback_and_resize(self):
        buf = io.BytesIO()
        Image.new("RGBA", (200, 200), (10, 20, 30, 255)).save(buf, format="PNG")
        png_bytes = buf.getvalue()

        with tempfile.TemporaryDirectory() as tmpdir:
            servants_dir = Path(tmpdir) / "servants"
            existing = servants_dir / "100100" / "000.webp"
            existing.parent.mkdir(parents=True, exist_ok=True)
            existing.write_bytes(b"already-here")

            fetched = []

            def fake_fetch_url(url, **kwargs):
                fetched.append(url)
                if url.endswith("f_1001001_bordered.png"):
                    raise RuntimeError("404 Not Found")
                return png_bytes, None

            face_urls = {
                "100100/000.webp": "https://static.atlasacademy.io/JP/Faces/f_1001000_bordered.png",
                "100100/001.webp": "https://static.atlasacademy.io/JP/Faces/f_1001001_bordered.png",
                "100100/c_100130.webp": "https://static.atlasacademy.io/JP/Faces/f_1001300_bordered.png",
            }
            with (
                patch.object(sync_atlas_data, "PUBLIC_SERVANTS_DIR", str(servants_dir)),
                patch.object(sync_atlas_data, "fetch_url", side_effect=fake_fetch_url),
            ):
                saved = sync_atlas_data.sync_servant_faces(face_urls)

            self.assertEqual(saved, 2)
            self.assertEqual(existing.read_bytes(), b"already-here")
            self.assertNotIn("https://static.atlasacademy.io/JP/Faces/f_1001000_bordered.png", fetched)
            self.assertIn("https://static.atlasacademy.io/JP/Faces/f_1001001.png", fetched)

            for rel in ("100100/001.webp", "100100/c_100130.webp"):
                dest = servants_dir / rel
                self.assertTrue(dest.exists())
                self.assertFalse((servants_dir / (rel + ".tmp")).exists())
                with Image.open(dest) as img:
                    self.assertEqual(img.format, "WEBP")
                    self.assertEqual(img.size, sync_atlas_data.FACE_ICON_SIZE)

    def test_single_skill_clean_title_includes_name(self):
        svt = _make_standard_servant()
        payload = build_servant_info_payload(svt)
        skills = [s for s in payload["formatted"]["slots"] if s["type"] == "skill"]
        self.assertEqual(skills[0]["variantsByTier"][0]["cleanTitle"], "Skill 1 (Charisma B)")
        self.assertEqual(skills[0]["variantsByTier"][1]["cleanTitle"], "Skill 1 (Charisma of Dragon A)")
        self.assertEqual(skills[1]["variantsByTier"][0]["cleanTitle"], "Skill 2 (Mana Burst A)")

    def test_multi_rank_up_tier_order_skills_and_nps(self):
        skills = [
            {"id": 136550, "num": 1, "name": "Galvanism A", "strengthStatus": 2, "priority": 1, "coolDown": [7], "functions": []},
            {"id": 685551, "num": 1, "name": "Tesla Coil A+", "strengthStatus": 1, "priority": 2, "coolDown": [7], "functions": []},
            {"id": 685552, "num": 1, "name": "Tesla Coil A++", "strengthStatus": 99, "priority": 3, "coolDown": [7], "functions": []},
        ]
        slot = format_skills_structured(skills, 201100)[0]
        self.assertEqual(slot["tiers"], [0, 1, 2])
        self.assertEqual(slot["variantsByTier"][0]["cleanTitle"], "Skill 1 (Galvanism A)")
        self.assertEqual(slot["variantsByTier"][1]["cleanTitle"], "Skill 1 (Tesla Coil A+)")
        self.assertEqual(slot["variantsByTier"][2]["cleanTitle"], "Skill 1 (Tesla Coil A++)")

        nps = [
            {"id": 700701, "num": 1, "name": "Kazikli Bey", "rank": "C", "type": "Single Target", "card": "arts", "strengthStatus": 2, "priority": 101, "functions": []},
            {"id": 700702, "num": 1, "name": "Kazikli Bey+", "rank": "C+", "type": "Single Target", "card": "arts", "strengthStatus": 1, "priority": 102, "functions": []},
            {"id": 700703, "num": 1, "name": "Kazikli Bey++", "rank": "B", "type": "Single Target", "card": "arts", "strengthStatus": 99, "priority": 103, "functions": []},
        ]
        np_slot = format_np_structured(nps, 700700)[0]
        self.assertEqual(np_slot["tiers"], [0, 1, 2])
        self.assertEqual(np_slot["variantsByTier"][0]["name"], "Kazikli Bey")
        self.assertEqual(np_slot["variantsByTier"][1]["name"], "Kazikli Bey+")
        self.assertEqual(np_slot["variantsByTier"][2]["name"], "Kazikli Bey++")

        # Fallback ordering without priority when strengthStatus=99 is present
        no_prio = [
            {"id": 10, "num": 1, "name": "Base", "strengthStatus": 2},
            {"id": 11, "num": 1, "name": "Rank1", "strengthStatus": 1},
            {"id": 12, "num": 1, "name": "Rank2", "strengthStatus": 99},
        ]
        grouped = group_and_label_items(no_prio, 1, "Skill")
        self.assertEqual([it["name"] for it, _ in grouped], ["Base", "Rank1", "Rank2"])

    def test_add_individuality_9999_does_not_fallback_to_robin_counter(self):
        self.assertNotIn(9999, TRAIT_ID_LABELS)
        inner_magic_bullet = {
            "id": 970499,
            "functions": [
                {
                    "funcId": 21660,
                    "funcType": "addState",
                    "funcTargetType": "self",
                    "buffs": [{"id": 5586, "name": "Magic Bullets", "type": "addIndividuality", "vals": [{"id": 3004}, {"id": 2885}]}],
                    "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 9999}],
                },
                {
                    "funcId": 21660,
                    "funcType": "addState",
                    "funcTargetType": "self",
                    "buffs": [{"id": 5586, "name": "Magic Bullets", "type": "addIndividuality", "vals": [{"id": 3004}, {"id": 2885}]}],
                    "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 9999}],
                },
            ],
        }
        inner_empty_name = {
            "id": 970739,
            "functions": [
                {
                    "funcId": 22893,
                    "funcType": "addState",
                    "funcTargetType": "self",
                    "buffs": [{"id": 5918, "name": "", "type": "addIndividuality", "vals": [{"id": 2999, "name": "unknown"}]}],
                    "svals": [{"Rate": 1000, "Turn": 1, "Count": -1, "Value": 9999}],
                }
            ],
        }
        passives = [
            {
                "id": 2353650,
                "name": "Deploy Magic Bullet EX",
                "functions": [
                    {
                        "funcId": 21661,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "buffs": [{"id": 5594, "name": "Triggers Each Turn", "type": "selfturnendFunction", "vals": [{"id": 3004}]}],
                        "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 970499}],
                    }
                ],
            },
            {
                "id": 2537551,
                "name": "Territory Creation",
                "functions": [
                    {
                        "funcId": 22894,
                        "funcType": "addStateShort",
                        "funcTargetType": "self",
                        "buffs": [{"id": 5916, "name": "", "type": "commandattackBeforeFunction", "vals": []}],
                        "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 970739}],
                    }
                ],
            },
        ]
        skill_by_id = {970499: inner_magic_bullet, 970739: inner_empty_name}
        ctx = FetchContext(fetch_inner_skill=lambda sid: skill_by_id.get(int(sid)))
        res = format_passives_structured(passives, ctx=ctx)
        effects_text = "\n".join(res[0]["variantsByTier"][0]["effects"])
        self.assertIn("Magic Bullets", effects_text)
        self.assertNotIn("Robin Counter", effects_text)

    def test_skill_icons_extraction_formatting_and_sync(self):
        std = _make_standard_servant()
        std["skills"][0]["icon"] = "https://static.atlasacademy.io/JP/SkillIcons/skill_00300.png"
        std["skills"][1]["icon"] = "https://static.atlasacademy.io/JP/SkillIcons/skill_00301.png"
        std["skills"][2]["icon"] = "https://static.atlasacademy.io/JP/SkillIcons/skill_00306.png"

        payload = build_servant_info_payload(std, svt_by_id={100100: std}, skill_by_id={})
        self._assert_clean_schema(payload)
        skills = {s["slotKey"]: s for s in payload["formatted"]["slots"] if s["type"] == "skill"}
        self.assertEqual(skills["skill_1"]["variantsByTier"][0]["icon"], "skill_icons/skill_00300.webp")
        self.assertEqual(skills["skill_1"]["variantsByTier"][1]["icon"], "skill_icons/skill_00301.webp")
        self.assertEqual(skills["skill_2"]["variantsByTier"][0]["icon"], "skill_icons/skill_00306.webp")
        self.assertNotIn("icon", skills["skill_3"]["variantsByTier"][0])

        main_svt, trans_svt = _make_transform_pair()
        main_svt["skills"][0]["icon"] = "https://static.atlasacademy.io/JP/SkillIcons/skill_00400.png"
        trans_svt["skills"][0]["icon"] = "https://static.atlasacademy.io/JP/SkillIcons/skill_00601.png"
        svt_by_id = build_svt_by_id([main_svt, trans_svt])
        t_payload = build_servant_info_payload(main_svt, svt_by_id=svt_by_id, skill_by_id={})
        self._assert_clean_schema(t_payload)
        t_var = next(s for s in t_payload["formatted"]["slots"] if s["type"] == "skill")["variantsByTier"][0]
        self.assertEqual(t_var["icon"], "skill_icons/skill_00400.webp")
        self.assertEqual(t_var["forms"][0]["icon"], "skill_icons/skill_00400.webp")
        self.assertEqual(t_var["forms"][1]["icon"], "skill_icons/skill_00601.webp")

        mash = _make_mash()
        mash["skills"][0]["icon"] = "https://static.atlasacademy.io/JP/SkillIcons/skill_00402.png"
        mash["skills"][1]["icon"] = "https://static.atlasacademy.io/JP/SkillIcons/skill_00404.png"
        m_payload = build_servant_info_payload(mash, svt_by_id={800100: mash}, skill_by_id={})
        self._assert_clean_schema(m_payload)
        m_skills = {s["slotKey"]: s for s in m_payload["formatted"]["slots"] if s["type"] == "skill"}
        self.assertEqual(m_skills["skill_1"]["variantsByTier"][0]["icon"], "skill_icons/skill_00402.webp")
        self.assertEqual(m_skills["skill_1"]["variantsByTier"][0]["forms"][0]["icon"], "skill_icons/skill_00402.webp")
        self.assertEqual(m_skills["skill_2"]["variantsByTier"][0]["icon"], "skill_icons/skill_00404.webp")

        urls = extract_skill_icons(main_svt, svt_by_id)
        self.assertEqual(
            urls,
            {
                "skill_00400.webp": "https://static.atlasacademy.io/JP/SkillIcons/skill_00400.png",
                "skill_00601.webp": "https://static.atlasacademy.io/JP/SkillIcons/skill_00601.png",
            },
        )

        buf = io.BytesIO()
        Image.new("RGBA", (128, 128), (40, 80, 120, 255)).save(buf, format="PNG")
        png_bytes = buf.getvalue()

        with tempfile.TemporaryDirectory() as tmpdir:
            icons_dir = Path(tmpdir) / "skill_icons"
            existing = icons_dir / "skill_00400.webp"
            existing.parent.mkdir(parents=True, exist_ok=True)
            existing.write_bytes(b"already-here")
            fetched = []

            def fake_fetch_url(url, **kwargs):
                fetched.append(url)
                return png_bytes, None

            with (
                patch.object(sync_atlas_data, "PUBLIC_SKILL_ICONS_DIR", str(icons_dir)),
                patch.object(sync_atlas_data, "fetch_url", side_effect=fake_fetch_url),
            ):
                saved = sync_atlas_data.sync_skill_icons(urls)

            self.assertEqual(saved, 1)
            self.assertEqual(existing.read_bytes(), b"already-here")
            self.assertEqual(fetched, ["https://static.atlasacademy.io/JP/SkillIcons/skill_00601.png"])
            dest = icons_dir / "skill_00601.webp"
            self.assertTrue(dest.exists())
            with Image.open(dest) as img:
                self.assertEqual(img.format, "WEBP")
                self.assertEqual(img.size, (128, 128))

    def test_uncovered_effect_texts_categories_a_through_l(self):
        from servant_info_converter.function_formatter import fmt_function
        from servant_info_converter.np_formatter import fmt_np_function
        from servant_info_converter.skill_formatter import format_skills_structured

        ctx = FetchContext(
            fetch_inner_skill=lambda sid: {
                967346: {
                    "id": 967346,
                    "functions": [
                        {
                            "funcType": "gainNpFromTargets",
                            "funcTargetType": "self",
                            "svals": [
                                {
                                    "Rate": 1000,
                                    "DependFunc": {"funcType": "lossNp", "funcTargetType": "enemy"},
                                    "DependFuncVals": {"Rate": 1000, "Value": 1000},
                                }
                            ],
                        }
                    ],
                },
                969850: {
                    "id": 969850,
                    "functions": [
                        {
                            "funcType": "addStateShort",
                            "funcTargetType": "ptAll",
                            "buffs": [{"id": 5112, "type": "upFuncHpReduce", "ckSelfIndv": [{"id": 3015}]}],
                            "svals": [{"Rate": 1000, "Turn": 5, "Value": 1000}],
                        }
                    ],
                },
                966580: {
                    "id": 966580,
                    "functions": [
                        {
                            "funcType": "subState",
                            "funcTargetType": "enemy",
                            "svals": [{"Rate": 1000, "Value": 1}],
                            "functvals": [{"id": 3004, "name": "Offensive Buff"}],
                        }
                    ],
                },
            }.get(int(sid))
        )

        # Category A & J: newly mapped funcTypes & gainNpFromTargets Value fallback
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "gainNpTargetSum",
                    "funcTargetType": "self",
                    "traitVals": [{"id": 5000}],
                    "svals": [{"Value": i * 1000} for i in range(1, 11)],
                }
            ),
            "Increase NP Gauge by 10-100% for yourself depending on number of enemies",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "gainNpBuffIndividualSum",
                    "funcTargetType": "self",
                    "traitVals": [{"id": 10047}],
                    "svals": [{"Value": 1000}],
                }
            ),
            "Increase NP Gauge by 10% per [Thirst for death] state for yourself",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "gainHpFromTargets",
                    "funcTargetType": "self",
                    "svals": [
                        {
                            "DependFunc": {"funcType": "lossHpSafe", "funcTargetType": "enemyAll"},
                            "DependFuncVals": {"Value": i * 100, "Value2": i * 100},
                        }
                        for i in range(1, 11)
                    ],
                }
            ),
            "Decrease HP by 100-1000 for all enemies and Restore HP by 100-1000 corresponding to the amount decreased for yourself",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "extendBuffturn",
                    "funcTargetType": "ptOne",
                    "svals": [{"Value": 1, "TargetList": [4001]}],
                }
            ),
            "Extend duration of [Arts] effects by 1 turns for a single ally",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "moveState",
                    "funcTargetType": "self",
                    "svals": [
                        {
                            "DependFunc": {
                                "funcTargetType": "enemyOne",
                                "traitVals": [{"id": 3026}],
                            }
                        }
                    ],
                }
            ),
            "Absorb [Curse] from one enemy for yourself [Demerit]",
        )
        self.assertEqual(
            fmt_function({"funcType": "extendUserEquipSkill", "funcTargetType": "self", "svals": [{"Value": 1}]}),
            "Increase Master Skill cooldown by 1 turns for yourself [Demerit]",
        )
        self.assertEqual(
            fmt_np_function(
                {
                    "funcType": "damageNpRare",
                    "funcTargetType": "enemyAll",
                    "svals": [{"Value": i * 1000, "Correction": 1500} for i in range(1, 6)],
                    "svals2": [{"Value": i * 1000, "Correction": 2000} for i in range(1, 6)],
                }
            ),
            "Deal heavy Special Attack [Low Rarity] by 150-200% damage <Special Attack damage increases with Overcharge> by 100-500% <effect increases with Level> to all enemies",
        )

        # Category B, C, E, F, G, H, I, J: buffTypes, trigger functions, traits, targets, Rank Up Skill, Spreading Fire
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addState",
                    "funcTargetType": "self",
                    "buffs": [{"id": 5379, "name": "呪い滲出", "type": "commandattackAfterFunction"}],
                    "svals": [{"Turn": 3, "Value": 967346}],
                },
                ctx=ctx,
            ),
            'Apply a state that "Decrease NP Gauge by 10% for one enemy and Increase NP Gauge by 10% corresponding to the amount decreased for yourself" when Normal attacking after damage (3 turns) for yourself',
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addStateShort",
                    "funcTargetType": "ptAll",
                    "buffs": [{"id": 5112, "type": "upFuncHpReduce", "ckSelfIndv": [{"id": 3015}]}],
                    "svals": [{"Turn": 5, "Value": i * 100} for i in range(1, 11)],
                },
                ctx=ctx,
            ),
            "Inflict Spreading Fire by 10-100% (5 turns) for all allies",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addStateShort",
                    "funcTargetType": "self",
                    "buffs": [{"id": 6250, "type": "skillRankUp"}],
                    "svals": [{"Turn": 3, "Value": 1}],
                }
            ),
            "Apply [Skill Rank Up] (3 turns) for yourself",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addStateShort",
                    "funcTargetType": "noTarget",
                    "buffs": [{"id": 6887, "type": "downDefence"}],
                    "svals": [{"Turn": 3, "Value": 200, "FieldBuffApplyTarget": 2}],
                }
            ),
            "Decrease DEF by 20% (3 turns) for all enemies on the field",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addState",
                    "funcTargetType": "ptOne",
                    "buffs": [{"id": 3437, "type": "addIndividuality", "vals": [{"id": 10058}]}],
                    "svals": [{"Turn": 3, "Value": 2355}],
                }
            ),
            "Apply [Illya] (3 turns) for a single ally",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addState",
                    "funcTargetType": "self",
                    "buffs": [
                        {"id": 6666, "type": "upHate", "ckOpIndv": [{"id": 100}, {"id": 101}]},
                    ],
                    "svals": [{"Turn": 3, "Value": 3000}],
                }
            ),
            "Apply Target Focus against [Saber and Lancer] (3 turns) for yourself",
        )
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addState",
                    "funcTargetType": "ptAll",
                    "buffs": [{"id": 9999, "type": "upCriticaldamage"}],
                    "svals": [{"Turn": 3, "Value": 200}],
                    "functvals": [{"id": 3}],
                }
            ),
            "Increase Critical Strength by 20% (3 turns) for all [Genderless] allies",
        )
        # Silent drop regression check: Dantès/Ushiwakamaru enemy offensive/defensive buff removal on attack is preserved
        self.assertEqual(
            fmt_function(
                {
                    "funcType": "addStateShort",
                    "funcTargetType": "self",
                    "buffs": [{"id": 5066, "type": "commandattackBeforeFunction"}],
                    "svals": [{"Turn": 3, "Value": 966580}],
                },
                ctx=ctx,
            ),
            'Apply a state that "Remove Debuffs for one enemy" when Normal attacking before damage (3 turns) for yourself',
        )

        # Category K: SelectAddInfo JP option labels translated to English matching frontend OPTION_TRANSLATIONS
        select_skill = [
            {
                "id": 1001,
                "num": 1,
                "name": "Choice Skill",
                "coolDown": [7] * 10,
                "extraPassive": [],
                "script": {
                    "SelectAddInfo": [
                        {
                            "title": "選択",
                            "btn": [
                                {"name": "消費しない", "conds": []},
                                {"name": "10個消費する", "conds": []},
                            ],
                        }
                    ]
                },
                "functions": [
                    {
                        "funcType": "gainNp",
                        "funcTargetType": "ptOne",
                        "svals": [{"Value": 3000, "ActSelectIndex": 0}],
                    },
                    {
                        "funcType": "gainNp",
                        "funcTargetType": "ptAll",
                        "svals": [{"Value": 2000, "ActSelectIndex": 1}],
                    },
                ],
            }
        ]
        formatted_select = format_skills_structured(select_skill, svt_id=100100)
        self.assertEqual(
            formatted_select[0]["variantsByTier"][0]["effects"],
            [
                "Select 2 Options ([Do not expend] / [Expend 10 Critical Stars])",
                "[Do not expend] Increase NP Gauge by 30% for a single ally",
                "[Expend 10 Critical Stars] Increase NP Gauge by 20% for all allies",
            ],
        )

    def test_np_duplicate_effect_collapsing(self):
        fn_dmg = {
            "funcType": "damageNp",
            "funcTargetType": "enemy",
            "svals": [{"Value": 6000}, {"Value": 10000}],
        }
        fn_dmg_2 = {
            "funcType": "damageNp",
            "funcTargetType": "enemy",
            "svals": [{"Value": 7000}, {"Value": 11000}],
        }

        # 1. True Name Reveal (??? vs revealed name with identical effects) -> single variant, revealed name
        true_name_nps = [
            {
                "id": 202100,
                "num": 1,
                "strengthStatus": 0,
                "priority": 100,
                "name": "???",
                "card": "2",
                "effectFlags": ["attackEnemyOne"],
                "npDistribution": [100],
                "npGain": {"buster": [87]},
                "functions": [fn_dmg],
                "releaseConditions": [],
            },
            {
                "id": 202101,
                "num": 1,
                "strengthStatus": 0,
                "priority": 101,
                "name": "On Arorikya Sowaka",
                "card": "2",
                "effectFlags": ["attackEnemyOne"],
                "npDistribution": [100],
                "npGain": {"buster": [87]},
                "functions": [fn_dmg],
                "releaseConditions": [],
            },
        ]
        slot_tn = format_np_structured(true_name_nps, 202100)[0]
        var_tn = slot_tn["variantsByTier"][0]
        self.assertEqual(var_tn["forms"], [])
        self.assertEqual(var_tn["name"], "On Arorikya Sowaka")
        self.assertEqual(var_tn["cleanTitle"], "Noble Phantasm (On Arorikya Sowaka)")

        # 2. Identical duplicate NP variants (e.g. animation swap with same name and effects) -> single variant
        same_nps = [
            dict(true_name_nps[1], id=101701, priority=101, name="Kurikara Divine Blade"),
            dict(true_name_nps[1], id=101702, priority=102, name="Kurikara Divine Blade"),
        ]
        slot_same = format_np_structured(same_nps, 101700)[0]
        self.assertEqual(slot_same["variantsByTier"][0]["forms"], [])

        # 3. Empty-function ??? placeholder dropped (Miyamoto Iori pattern) -> single variant
        iori_nps = [
            dict(true_name_nps[1], id=106001, priority=101, name="Hidden Sword"),
            {
                "id": 106099,
                "num": 1,
                "strengthStatus": 0,
                "priority": 199,
                "name": "???",
                "card": "2",
                "effectFlags": [],
                "npDistribution": [],
                "npGain": {"buster": [42]},
                "functions": [],
                "releaseConditions": [],
            },
        ]
        slot_iori = format_np_structured(iori_nps, 106000)[0]
        self.assertEqual(slot_iori["variantsByTier"][0]["forms"], [])
        self.assertEqual(slot_iori["variantsByTier"][0]["name"], "Hidden Sword")

        # 4. Duplicate 3rd Ascension collapsed while keeping distinct 1st&2nd Ascension (Elisabeth pattern)
        elisabeth_nps = [
            dict(true_name_nps[1], id=306201, priority=103, name="Bathory", functions=[fn_dmg], releaseConditions=[]),
            dict(
                true_name_nps[1],
                id=306202,
                priority=102,
                name="Veilmarsh",
                functions=[fn_dmg_2],
                releaseConditions=[{"condType": "equipWithTargetCostume", "condNum": 3}],
            ),
            dict(
                true_name_nps[1],
                id=306204,
                priority=104,
                name="Veilmarsh",
                functions=[fn_dmg_2],
                releaseConditions=[{"condType": "equipWithTargetCostume", "condNum": 3}],
            ),
        ]
        slot_eli = format_np_structured(elisabeth_nps, 306200)[0]
        forms_eli = slot_eli["variantsByTier"][0]["forms"]
        self.assertEqual(len(forms_eli), 2)
        self.assertEqual([f["label"] for f in forms_eli], ["1st&2nd Ascension", "3rd Ascension"])
        self.assertEqual([f["formIndex"] for f in forms_eli], [0, 1])

    def test_skill_duplicate_effect_collapsing(self):
        fn_atk = {
            "funcType": "addState",
            "funcTargetType": "self",
            "buffs": [{"id": 1, "type": "upAtk"}],
            "svals": [{"Turn": 3, "Value": 200}, {"Turn": 3, "Value": 300}],
        }
        dup_skills = [
            {
                "id": 99001,
                "num": 1,
                "strengthStatus": 0,
                "name": "???",
                "coolDown": [7, 6, 5],
                "functions": [fn_atk],
                "skillSvts": [{"svtId": 990000, "releaseConditions": [{"condType": "equipWithTargetCostume", "condNum": 1}]}],
            },
            {
                "id": 99002,
                "num": 1,
                "strengthStatus": 0,
                "name": "Real Skill Name A",
                "coolDown": [7, 6, 5],
                "functions": [fn_atk],
                "skillSvts": [{"svtId": 990000, "releaseConditions": [{"condType": "equipWithTargetCostume", "condNum": 3}]}],
            },
        ]
        slot = format_skills_structured(dup_skills, svt_id=990000)[0]
        var0 = slot["variantsByTier"][0]
        self.assertEqual(var0["forms"], [])
        self.assertEqual(var0["cleanTitle"], "Skill 1 (Real Skill Name A)")

    def test_extract_saint_graphs_np_and_skill_names(self):
        u = "https://static.atlasacademy.io/JP/CharaGraph/%s/%s.png"
        svt = {
            "id": 990000,
            "name": "Test Servant",
            "noblePhantasms": [{"id": 990001, "name": "Base NP"}],
            "skills": [
                {"id": 9901, "num": 1, "name": "Base Skill 1"},
                {"id": 9902, "num": 2, "name": "Base Skill 2"},
            ],
            "ascensionAdd": {
                "overWriteTDName": {
                    "ascension": {"0": "Base NP", "3": "Ascended NP", "4": "Ascended NP"},
                    "costume": {"11": "Costume NP"},
                },
                "overwriteSkillName": {
                    "ascension": {
                        "0": [{"id": 9901, "value": "Base Skill 1"}],  # no-op skipped
                        "3": [{"id": 9901, "value": "Ascended Skill 1"}],
                    },
                    "costume": {
                        "11": [{"id": 9902, "value": "Costume Skill 2"}],
                    },
                },
            },
            "extraAssets": {
                "charaGraph": {
                    "ascension": {
                        "1": u % ("990000", "a1"),
                        "3": u % ("990000", "a3"),
                        "4": u % ("990000", "a4"),
                    },
                    "costume": {
                        "990030": u % ("990030", "c1"),
                    },
                }
            },
            "profile": {
                "costume": {
                    "990030": {"id": 11, "shortName": "Dress"},
                }
            },
        }
        entries, _ = extract_saint_graphs(svt)
        by_key = {e["key"]: e for e in entries}
        self.assertNotIn("npName", by_key["1"])
        self.assertNotIn("skillNames", by_key["1"])
        self.assertEqual(by_key["3"].get("npName"), "Ascended NP")
        self.assertEqual(by_key["3"].get("skillNames"), {"skill_1": "Ascended Skill 1"})
        self.assertEqual(by_key["4"].get("npName"), "Ascended NP")
        self.assertEqual(by_key["990030"].get("npName"), "Costume NP")
        self.assertEqual(by_key["990030"].get("skillNames"), {"skill_2": "Costume Skill 2"})

    def test_np_act_set_weight_labels(self):
        np_data = {
            "id": 901200,
            "num": 1,
            "name": "Dinosaur Summer Goodbye",
            "card": "buster",
            "type": "buster",
            "effectFlags": ["attackEnemyOne"],
            "npDistribution": [33, 33, 34],
            "npGain": {"buster": [67, 67, 67, 67, 67]},
            "script": {},
            "functions": [
                {
                    "funcId": 1,
                    "funcType": "damageNp",
                    "funcTargetType": "enemy",
                    "funcTargetTeam": "enemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "Value": 600}],
                    "svals2": [{"Rate": 1000, "Value": 800}],
                    "svals3": [{"Rate": 1000, "Value": 900}],
                    "svals4": [{"Rate": 1000, "Value": 950}],
                    "svals5": [{"Rate": 1000, "Value": 1000}],
                },
                {
                    "funcId": 2,
                    "funcType": "gainStar",
                    "funcTargetType": "player",
                    "funcTargetTeam": "player",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "Value": 30, "ActSet": 1, "ActSetWeight": 33}],
                },
                {
                    "funcId": 3,
                    "funcType": "gainNp",
                    "funcTargetType": "ptAll",
                    "funcTargetTeam": "player",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "Value": 2000, "ActSet": 2, "ActSetWeight": 33}],
                },
                {
                    "funcId": 4,
                    "funcType": "addStateShort",
                    "funcTargetType": "ptAll",
                    "funcTargetTeam": "player",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 101, "type": "upAtk", "name": "ATK Up"}],
                    "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 200, "ActSet": 3, "ActSetWeight": 33}],
                },
            ],
        }
        info = _extract_single_np_data(np_data)
        fx = info["effects"]
        self.assertEqual(fx.count("[33% Chance]"), 3)
        first_chance_idx = fx.index("[33% Chance]")
        self.assertGreater(first_chance_idx, 0)
        self.assertIn("Deal significant damage", fx[0])
        self.assertEqual(fx[first_chance_idx + 1], "Gain Critical Stars by 30")
        second_chance_idx = fx.index("[33% Chance]", first_chance_idx + 1)
        self.assertIn("NP Gauge", fx[second_chance_idx + 1])

    def test_append_skills_slot_and_formatting(self):
        svt = _make_standard_servant()
        svt["appendPassive"] = [
            {
                "num": 100,
                "priority": 1,
                "skill": {
                    "id": 3001000,
                    "name": "Extra Attack Boost",
                    "functions": [
                        {
                            "funcId": 30003,
                            "funcType": "addStateShort",
                            "funcTargetType": "self",
                            "funcTargetTeam": "playerAndEnemy",
                            "functvals": [],
                            "funcquestTvals": [],
                            "buffs": [{"id": 101, "type": "upCommandall", "name": "Extra Up", "ckSelfIndv": [{"id": 4004, "name": "cardExtra"}]}],
                            "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 300}, {"Rate": 1000, "Turn": -1, "Count": -1, "Value": 500}],
                        }
                    ],
                },
            },
            {
                "num": 104,
                "priority": 1,
                "skill": {
                    "id": 3034000,
                    "name": "Skill Reload",
                    "functions": [
                        {
                            "funcId": 30170,
                            "funcType": "addState",
                            "funcTargetType": "self",
                            "funcTargetTeam": "playerAndEnemy",
                            "functvals": [],
                            "funcquestTvals": [],
                            "buffs": [{"id": 30059, "type": "shortenSkillAfterUseSkill", "name": "Reduce Cooldown after Skill Use"}],
                            "svals": [
                                {"Rate": 1000, "Turn": -1, "Count": 1, "Value": 1, "ShortenMaxCountEachSkill": [1, 1, 1]},
                                {"Rate": 1000, "Turn": -1, "Count": 3, "Value": 1, "ShortenMaxCountEachSkill": [1, 1, 1]},
                            ],
                        }
                    ],
                },
            },
        ]
        payload = build_servant_info_payload(svt, svt_by_id={svt["id"]: svt}, skill_by_id={})
        self._assert_clean_schema(payload)
        fmt = payload["formatted"]
        self.assertNotIn("appendSkills", fmt)
        self.assertEqual(fmt["slots"][-1]["slotKey"], "append_1")
        self.assertEqual(fmt["slots"][-2]["slotKey"], "passive_1")
        ap_slot = fmt["slots"][-1]
        self.assertEqual(ap_slot["slotKey"], "append_1")
        self.assertEqual(ap_slot["type"], "append")
        effects = ap_slot["variantsByTier"][0]["effects"]
        self.assertEqual(effects[0], "Increase Extra Card effectiveness by 30-50% for yourself")
        self.assertEqual(effects[1], "Reduce used skill's cooldown by 1 after Skill Use (1-3 times, max 1 time per skill) for yourself")

    def test_loss_np_enemy_targets_pruned(self):
        from servant_info_converter.function_formatter import fmt_function

        def loss_np(target_type, team="playerAndEnemy"):
            return {
                "funcId": 995,
                "funcType": "lossNp",
                "funcTargetType": target_type,
                "funcTargetTeam": team,
                "svals": [{"Rate": 1000, "Value": 2000}],
            }

        # Enemies have no NP gauge, only Charge: every enemy-side target is pruned.
        for target_type in ("enemy", "enemyOne", "enemyAll"):
            self.assertIsNone(fmt_function(loss_np(target_type)), target_type)

        # Player-side NP loss is a real demerit and still renders.
        self.assertEqual(fmt_function(loss_np("self")), "Decrease NP Gauge by 20% for yourself [Demerit]")

    def test_hide_miss_and_internal_dummy_exclusions(self):
        inner_death = {
            "id": 970911,
            "functions": [
                {
                    "funcId": 23451,
                    "funcType": "forceInstantDeath",
                    "funcTargetType": "self",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "script": {"funcIndividuality": [{"id": 3139, "name": "unknown"}]},
                    "buffs": [],
                    "svals": [{"Rate": 5000, "HideMiss": 1, "HideNoEffect": 1}],
                }
            ],
        }
        delay_fn = {
            "funcId": 23446,
            "funcType": "addStateShort",
            "funcTargetType": "ptOne",
                    "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 6081, "type": "delayFunction", "name": "Delayed Effect", "vals": [{"id": 3005}]}],
            "svals": [{"Rate": 5000, "Turn": 3, "Count": -1, "Value": 970911}],
        }
        ctx = FetchContext(fetch_inner_skill=lambda sid: inner_death if sid == 970911 else None)
        res = fmt_function(delay_fn, ctx=ctx)
        self.assertEqual(res, 'After 3 turns "Apply Death <Ignore Guts> for yourself [Demerit]" (3 turns) for a single ally')

        # Servant 353 Lady Avalon Skill 3: downNpturnval enemy-targeting debuff
        down_np_turn_val_fn = {
            "funcId": 9131,
            "funcType": "addState",
            "funcTargetType": "enemyAll",
            "funcTargetTeam": "enemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 4539, "type": "downNpturnval", "name": "Charge Down Each Turn"}],
            "svals": [{"Rate": 1000, "Turn": -1, "Count": 1, "Value": 1}],
        }
        self.assertEqual(
            fmt_function(down_np_turn_val_fn),
            "Apply a state where Charge is decreased by 1 each turn (1 time) for all enemies",
        )

        # Internal dummy hooks remain suppressed
        dummy_indv = {
            "funcId": 20887,
            "funcType": "addState",
            "funcTargetType": "enemyAll",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 9999, "type": "addIndividuality", "name": ""}],
            "svals": [{"Rate": 5000, "Turn": 1, "Count": -1, "Value": 9999, "HideMiss": 1, "HideNoEffect": 1, "ShowState": -1}],
        }
        self.assertIsNone(fmt_function(dummy_indv))
        dummy_up_dmg = {
            "funcId": 1259,
            "funcType": "addStateShort",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 100, "type": "upDamage", "name": "Strength Up"}],
            "svals": [{"Rate": 1000, "Turn": 1, "Count": -1, "Value": 0, "HideMiss": 1, "HideNoEffect": 1, "ShowState": -1}],
        }
        self.assertIsNone(fmt_function(dummy_up_dmg))
        dummy_sub = {
            "funcId": 20888,
            "funcType": "subState",
            "funcTargetType": "enemyAll",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "traitVals": [{"id": 2860, "name": "happyHalloweenCounter"}],
            "buffs": [],
            "svals": [{"Rate": 5000, "HideMiss": 1, "HideNoEffect": 1}],
        }
        self.assertIsNone(fmt_function(dummy_sub))

        # Genuine HideMiss effects render (e.g. Nobukatsu buff + Yamato Takeru deadFunction)
        nobukatsu_fn = {
            "funcId": 5880,
            "funcType": "addStateShort",
            "funcTargetType": "ptAll",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [{"id": 2721, "name": "nobunaga"}],
            "funcquestTvals": [],
            "buffs": [{"id": 142, "type": "upCriticaldamage", "name": "Critical Strength Up"}],
            "svals": [
                {"Rate": 1000, "Turn": 3, "Count": -1, "Value": 300, "HideMiss": 1, "HideNoEffect": 1},
                {"Rate": 1000, "Turn": 3, "Count": -1, "Value": 800, "HideMiss": 1, "HideNoEffect": 1},
            ],
        }
        self.assertEqual(
            fmt_function(nobukatsu_fn),
            "Increase Critical Strength by 30-80% (3 turns) for all [Nobunaga] allies",
        )
        dead_fn = {
            "funcId": 21302,
            "funcType": "addState",
            "funcTargetType": "ptFull",
            "funcTargetTeam": "player",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 5513, "type": "deadFunction", "name": ""}],
            "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 970452, "HideMiss": 1, "HideNoEffect": 1, "ShowState": -1}],
        }
        self.assertEqual(
            fmt_function(dead_fn),
            'Apply a state that "Increase NP Gauge for yourself" when an ally is defeated for all allies',
        )

    def test_delay_fn_follows_additional_skill_id(self):
        inner_skills = {
            970409: {"id": 970409, "script": {"additionalSkillId": [970412]}, "functions": [{"funcId": 0, "funcType": "none", "funcTargetType": "self"}]},
            970412: {
                "id": 970412,
                "functions": [
                    {
                        "funcId": 7011,
                        "funcType": "moveToLastSubmember",
                        "funcTargetType": "self",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [],
                        "svals": [{"Rate": 1000}],
                    }
                ],
            },
        }
        fn = {
            "funcId": 21112,
            "funcType": "addStateShort",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 5447, "type": "delayFunction", "name": "Preparing Replacement"}],
            "svals": [{"Rate": 1000, "Turn": 1, "Count": 1, "Value": 970409}],
        }
        ctx = FetchContext(fetch_inner_skill=lambda sid: inner_skills.get(sid))
        res = fmt_function(fn, ctx=ctx)
        self.assertEqual(
            res,
            'After 1 turn "Retreat to the sub-member slot <cannot retreat if there is only 1 allied Servant on the field>" (1 time, 1 turn) for yourself',
        )

    def test_consecutive_same_func_id_not_collapsed_and_passive_stacking(self):
        skills = [
            {
                "id": 25550,
                "num": 2,
                "name": "Morph A",
                "strengthStatus": 0,
                "coolDown": [7, 5],
                "script": {},
                "functions": [
                    {
                        "funcId": 176,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [{"id": 120, "type": "upDefence", "name": "DEF Up"}],
                        "svals": [{"Rate": 1000, "Turn": 1, "Count": -1, "Value": 300}, {"Rate": 1000, "Turn": 1, "Count": -1, "Value": 300}],
                    },
                    {
                        "funcId": 176,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [{"id": 120, "type": "upDefence", "name": "DEF Up"}],
                        "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 100}, {"Rate": 1000, "Turn": 3, "Count": -1, "Value": 300}],
                    },
                ],
            }
        ]
        slots = format_skills_structured(skills, 500300)
        fx = slots[0]["variantsByTier"][0]["effects"]
        self.assertEqual(
            fx,
            ["Increase DEF by 30% (1 turn) for yourself", "Increase DEF by 10-30% (3 turns) for yourself"],
        )

        passives = [
            {
                "id": 34550,
                "name": "Magic Resistance A",
                "functions": [
                    {
                        "funcId": 388,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [{"id": 160, "type": "upTolerance", "name": "Debuff Resist Up"}],
                        "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 200}],
                    }
                ],
            },
            {
                "id": 30350,
                "name": "Core of the Goddess C",
                "functions": [
                    {
                        "funcId": 389,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [{"id": 160, "type": "upTolerance", "name": "Debuff Resist Up"}],
                        "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 200}],
                    }
                ],
            },
        ]
        p_slots = format_passives_structured({"id": 103900, "classPassive": passives})
        self.assertEqual(
            p_slots[0]["variantsByTier"][0]["effects"],
            ["Increase Debuff Resist by 20% for yourself", "Increase Debuff Resist by 20% for yourself"],
        )

    def test_skill_conditions_gates_userate_substate_and_prefixes(self):
        # QSH S3 Invincible condition
        qsh_fn = {
            "funcId": 23301,
            "funcType": "addState",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 120, "type": "upDefence", "name": "DEF Up", "script": {"INDIVIDUALITIE": {"id": 3022, "name": "buffInvincible"}}}],
            "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 1000}],
        }
        self.assertEqual(fmt_function(qsh_fn), "Increase DEF by 100% (3 turns) if [Invincible] for yourself")

        # Nemo/Noah ParamAddOpIndividualityAndCheck + INDIVIDUALITIE_OR
        nemo_crit = {
            "funcId": 201,
            "funcType": "addStateShort",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 142, "type": "upCriticaldamage", "name": "Crit Up"}],
            "svals": [
                {
                    "Rate": 1000,
                    "Turn": 3,
                    "Count": -1,
                    "Value": 500,
                    "ParamAddValue": 250,
                    "ParamAddIndividualityTargetType": 32,
                    "ParamAddOpIndividualityAndCheck": [[2005, 2632, 2821, -10000]],
                }
            ],
        }
        self.assertEqual(
            fmt_function(nemo_crit),
            "Increase Critical Strength by 50% <increases by 25% based on the number of [Animal] states> (3 turns) for yourself",
        )

        # skill.script gates
        gated_skills = [
            {"id": 1, "num": 1, "name": "HP High", "coolDown": [5, 5], "script": {"HP_VAL_HIGHER": [500, 500]}, "functions": []},
            {"id": 2, "num": 2, "name": "HP Low", "coolDown": [5, 5], "script": {"HP_PER_LOWER": [500, 500]}, "functions": []},
            {"id": 3, "num": 3, "name": "Init CD", "coolDown": [8, 8], "script": {"battleStartRemainingTurn": [5, 5]}, "functions": []},
        ]
        g_slots = format_skills_structured(gated_skills, 103100)
        self.assertEqual(g_slots[0]["variantsByTier"][0]["effects"], ["[Usable only when HP is 500 or higher]"])
        self.assertEqual(g_slots[1]["variantsByTier"][0]["effects"], ["[Usable only when HP is 50% or lower]"])
        self.assertEqual(g_slots[2]["variantsByTier"][0]["effects"], ["[Initial Cooldown: 5 turns]"])

        # UseRate, subState Value2, multi-trait get_card_prefix, passive guts prefix
        fionn_fn = {
            "funcId": 686,
            "funcType": "addState",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 10, "type": "avoidance", "name": "Evade"}],
            "svals": [{"Rate": 1000, "Turn": 1, "Count": -1, "UseRate": 600}, {"Rate": 1000, "Turn": 1, "Count": -1, "UseRate": 1000}],
        }
        self.assertEqual(fmt_function(fionn_fn), "60-100% Chance to Apply Evade (1 turn) for yourself")

        jason_fn = {
            "funcId": 3855,
            "funcType": "subState",
            "funcTargetType": "ptOne",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "traitVals": [{"id": 3005, "name": "buffNegativeEffect"}],
            "buffs": [],
            "svals": [{"Rate": 1000, "Value": 0, "Value2": 1}],
        }
        self.assertEqual(fmt_function(jason_fn), "Remove 1 Debuff for a single ally")

        muramasa_fn = {
            "funcId": 6511,
            "funcType": "addStateShort",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{
                "id": 142,
                "type": "upCriticaldamage",
                "name": "Crit Up",
                "ckOpIndv": [{"id": 3021}, {"id": 3022}, {"id": 3018}],
            }],
            "svals": [{"Rate": 1000, "Turn": 1, "Count": -1, "Value": 500}, {"Rate": 1000, "Turn": 1, "Count": -1, "Value": 1000}],
        }
        self.assertEqual(
            fmt_function(muramasa_fn),
            "Increase Critical Strength against [Evade or Invincible] enemies by 50-100% (1 turn) for yourself",
        )

        alice_passive = [
            {
                "id": 2342350,
                "name": "Yumina C",
                "functions": [
                    {
                        "funcId": 21418,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [{"id": 200, "type": "guts", "name": "Guts", "ckOpIndv": [{"id": 3096}, {"id": 3097}]}],
                        "svals": [{"Rate": 1000, "Turn": -1, "Count": 5, "Value": 1000}],
                    }
                ],
            }
        ]
        alice_slots = format_passives_structured({"id": 505500, "classPassive": alice_passive})
        self.assertEqual(
            alice_slots[0]["variantsByTier"][0]["effects"],
            ["Apply Guts [On Instant Death] by 1000 (5 times) for yourself"],
        )

    def test_np_oc_scaling_correction_solo_crit_eresh_medb_chengong(self):
        # 1. Rate OC, gainStar OC, Value2 trigger OC, damageNp OC-bonus, Level-scaling Correction, solo downCriticalrate, Ereshkigal, Medb, Chen Gong, Kingprotea Alter
        inner_miyu = {
            962350: {
                "id": 962350,
                "functions": [
                    {
                        "funcId": 476,
                        "funcType": "gainStar",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [],
                        "svals": [{"Rate": 1000, "Value": 5}, {"Rate": 1000, "Value": 25}],
                    }
                ],
            }
        }
        np_data = {
            "id": 999901,
            "num": 1,
            "name": "Test NP",
            "card": "arts",
            "type": "arts",
            "effectFlags": ["attackEnemyAll"],
            "npDistribution": [50, 50],
            "npGain": {"arts": [50]},
            "script": {},
            "functions": [
                {
                    "funcId": 348,
                    "funcType": "addState",
                    "funcTargetType": "enemyAll",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 348, "type": "donotAct", "name": "Charm", "vals": [{"id": 3012, "name": "Charm"}]}],
                    "svals": [{"Rate": 100, "Turn": 1, "Count": -1}],
                    "svals5": [{"Rate": 500, "Turn": 1, "Count": -1}],
                },
                {
                    "funcId": 477,
                    "funcType": "gainStar",
                    "funcTargetType": "self",
                    "funcTargetTeam": "player",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "Value": 5}],
                    "svals5": [{"Rate": 1000, "Value": 25}],
                },
                {
                    "funcId": 3275,
                    "funcType": "addState",
                    "funcTargetType": "self",
                    "funcTargetTeam": "player",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 999, "type": "selfturnendFunction", "name": "Protection of Sakatsuki"}],
                    "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 962350, "Value2": 1}],
                    "svals5": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 962350, "Value2": 5}],
                },
                {
                    "funcId": 13,
                    "funcType": "damageNp",
                    "funcTargetType": "enemyAll",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "Value": 0}],
                    "svals2": [{"Rate": 1000, "Value": 1000}],
                    "svals5": [{"Rate": 1000, "Value": 4000}],
                },
                {
                    "funcId": 16,
                    "funcType": "damageNpIndividual",
                    "funcTargetType": "enemy",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "Value": 9000, "Target": 1, "Correction": 1500}, {"Rate": 1000, "Value": 9000, "Target": 1, "Correction": 2500}],
                    "svals5": [{"Rate": 1000, "Value": 9000, "Target": 1, "Correction": 1500}, {"Rate": 1000, "Value": 9000, "Target": 1, "Correction": 2500}],
                },
                {
                    "funcId": 228,
                    "funcType": "addState",
                    "funcTargetType": "enemyAll",
                    "funcTargetTeam": "enemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 228, "type": "downCriticalrate", "name": "Crit Rate Down"}],
                    "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 100}],
                    "svals5": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 500}],
                },
                {
                    "funcId": 21839,
                    "funcType": "displayBuffstring",
                    "funcTargetType": "self",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "CheckOverChargeStageRange": ["1<="]}],
                    "svals5": [{"Rate": 5000, "CheckOverChargeStageRange": ["1<="]}],
                },
                {
                    "funcId": 1588,
                    "funcType": "addStateShort",
                    "funcTargetType": "self",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 1588, "type": "pierceDefence", "name": "Ignore DEF"}],
                    "svals": [{"Rate": 1000, "Turn": 1, "Count": -1, "HideMiss": 1, "HideNoEffect": 1, "CheckBattlePointPhaseRange": [{"battlePointId": 3300200, "range": ["7<="]}]}],
                },
                {
                    "funcId": 2571,
                    "funcType": "lossHp",
                    "funcTargetType": "enemy",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000, "Value": 0}],
                },
                {
                    "funcId": 2562,
                    "funcType": "addStateShort",
                    "funcTargetType": "enemy",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 148, "type": "downDefence", "name": "DEF Down"}],
                    "svals": [{"Rate": 600, "Turn": 3, "Count": -1, "Value": 100}],
                    "svals5": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 100}],
                },
                {
                    "funcId": 2562,
                    "funcType": "addStateShort",
                    "funcTargetType": "enemy",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 148, "type": "downDefence", "name": "DEF Down"}],
                    "svals": [{"Rate": 600, "Turn": 3, "Count": -1, "Value": 100}],
                    "svals5": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 100}],
                },
                {
                    "funcId": 3851,
                    "funcType": "forceInstantDeath",
                    "funcTargetType": "ptSelfAnotherFirst",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [],
                    "svals": [{"Rate": 1000}],
                },
                {
                    "funcId": 23468,
                    "funcType": "addStateShortUserEquipSkillAvailable",
                    "funcTargetType": "self",
                    "funcTargetTeam": "playerAndEnemy",
                    "functvals": [],
                    "funcquestTvals": [],
                    "buffs": [{"id": 138, "type": "upNpdamage", "name": "NP Strength Up"}],
                    "svals": [{"Rate": 1000, "Turn": 1, "Count": -1, "Value": 200, "ParamAddMaxCount": 3}],
                },
            ],
        }
        ctx = FetchContext(fetch_inner_skill=lambda sid: inner_miyu.get(sid))
        fx = _extract_single_np_data(np_data, ctx=ctx)["effects"]
        self.assertIn("10-50% Chance to Inflict Charm (1 turn) to all enemies <effect increases with Overcharge>", fx)
        self.assertIn("Gain Critical Stars by 5-25 <effect increases with Overcharge>", fx)
        self.assertIn('Inflict Protection of Sakatsuki <Apply a state that "Gain Critical Stars by 5-25" at turn end> (3 turns) for yourself <effect increases with Overcharge>', fx)
        self.assertIn("Deal additional heavy damage by 100-400% (at OC2-5) <effect increases with Overcharge> to all enemies", fx)
        self.assertIn("Deal significant Special Attack [Male] by 150-250% damage <Special Attack damage increases with Level> by 900% <effect increases with Level> to a single enemy", fx)
        self.assertIn("Decrease Critical Rate by 10-50% (3 turns) for all enemies <effect increases with Overcharge>", fx)
        self.assertIn("Increase Master Affection Gauge <effect increases with Overcharge> for yourself", fx)
        self.assertIn("When Master Affection Level is 7 or higher, Apply Ignore DEF (1 turn) for yourself", fx)
        self.assertFalse(any("Reduce HP by 0" in line for line in fx))
        self.assertIn("60-100% Chance to Decrease DEF by 10% (3 turns) for one enemy <effect increases with Overcharge> (x2)", fx)
        self.assertIn("Apply Death for the front-most single ally, excluding yourself [Demerit]", fx)
        self.assertIn("Increase NP Strength by 20% per Master Skill drained (Max 3) (1 turn) for yourself", fx)

    def test_sub_individuality_and_npattack_prev_buff(self):
        sub_indv_fn = {
            "funcId": 9620,
            "funcType": "addState",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 5489, "type": "subIndividuality", "name": ""}],
            "svals": [{"Rate": 1000, "Turn": -1, "Count": -1, "Value": 301, "HideMiss": 1, "HideNoEffect": 1, "ShowState": -1}],
        }
        self.assertEqual(fmt_function(sub_indv_fn), "Remove [Chaotic] trait for yourself")

        hokusai_inner = {
            961313: {
                "id": 961313,
                "functions": [
                    {
                        "funcId": 194,
                        "funcType": "addStateShort",
                        "funcTargetType": "enemy",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [{"id": 148, "type": "downDefence", "name": "DEF Down"}],
                        "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 100}, {"Rate": 1000, "Turn": 3, "Count": -1, "Value": 200}],
                    }
                ],
            }
        }
        np_prev_fn = {
            "funcId": 2096,
            "funcType": "addStateShort",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 894, "type": "npattackPrevBuff", "name": 'Pseudonym "Iseidako"', "ckSelfIndv": [{"id": 4001, "name": "cardArts"}]}],
            "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 4, "SkillID": 961313, "HideMiss": 1, "HideNoEffect": 1}],
        }
        ctx = FetchContext(fetch_inner_skill=lambda sid: hokusai_inner.get(sid))
        self.assertEqual(
            fmt_function(np_prev_fn, ctx=ctx),
            'Apply a state that "Decrease DEF by 10-20% (3 turns) for one enemy" when Arts attacking with NP before damage (3 turns) for yourself',
        )

    def test_lord_logres_and_oberon_s3_special_sleep(self):
        inner_skills = {
            970829: {
                "id": 970829,
                "functions": [
                    {
                        "funcId": 23177,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [
                            {
                                "id": 6011,
                                "type": "donotAct",
                                "name": "湖水の夢",
                                "vals": [
                                    {"id": 3005, "name": "buffNegativeEffect"},
                                    {"id": 3045, "name": "buffImmobilize"},
                                    {"id": 3010, "name": "buffMentalEffect"},
                                    {"id": 3066, "name": "buffSleep"},
                                    {"id": 3076, "name": "cantBeSacrificed"},
                                ],
                            }
                        ],
                        "svals": [{"Rate": 5000, "Turn": t, "Count": -1} for t in (6, 6, 6, 6, 6, 4, 4, 4, 4, 2)],
                    },
                    {
                        "funcId": 23178,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "enemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [
                            {
                                "id": 6012,
                                "type": "donotAct",
                                "name": "湖水の夢",
                                "vals": [
                                    {"id": 3005, "name": "buffNegativeEffect"},
                                    {"id": 3066, "name": "buffSleep"},
                                    {"id": 3076, "name": "cantBeSacrificed"},
                                ],
                            }
                        ],
                        "svals": [{"Rate": 5000, "Turn": t, "Count": -1} for t in (6, 6, 6, 6, 6, 4, 4, 4, 4, 2)],
                    },
                    {
                        "funcId": 7485,
                        "funcType": "addState",
                        "funcTargetType": "self",
                        "funcTargetTeam": "playerAndEnemy",
                        "functvals": [],
                        "funcquestTvals": [],
                        "buffs": [{"id": 3760, "type": "donotReplace", "name": ""}],
                        "svals": [
                            {
                                "Rate": 5000,
                                "Turn": t,
                                "Count": -1,
                                "HideMiss": 1,
                                "HideNoEffect": 1,
                                "ShowState": -1,
                            }
                            for t in (6, 6, 6, 6, 6, 4, 4, 4, 4, 2)
                        ],
                    },
                ],
            }
        }
        logres_delay_fn = {
            "funcId": 23146,
            "funcType": "addState",
            "funcTargetType": "self",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 6005, "type": "delayFunction", "name": "エニス・グイトリン"}],
            "svals": [{"Rate": 5000, "Turn": 3, "Count": -1, "Value": 970829, "Value2": i} for i in range(1, 11)],
        }
        ctx = FetchContext(fetch_inner_skill=lambda sid: inner_skills.get(sid))
        self.assertEqual(
            fmt_function(logres_delay_fn, ctx=ctx),
            'After 3 turns "500% Chance to Apply [Lake Water Dream] '
            "<nullify Resistance, unable to remove, unable to select Sacrifice, unable to Order Change> "
            '(6-2 turns) for yourself" (3 turns) for yourself',
        )

        oberon_s3_fn = {
            "funcId": 7367,
            "funcType": "addState",
            "funcTargetType": "ptOne",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "buffs": [{"id": 3712, "type": "selfturnendFunction", "name": "Ending of Dreams"}],
            "svals": [{"Rate": 5000, "Turn": -1, "Count": 1, "Value": 966458, "Value2": 1}],
        }
        self.assertEqual(
            fmt_function(oberon_s3_fn),
            'Inflict Ending of Dreams <Apply a state that "Removes Buffs & Apply [Eternal Slumber] '
            "<nullify Resistance, unable to remove, unable to select Sacrifice, unable to Order Change> "
            '& Apply Target Focus (3 turns)" at turn end> (1 time) for a single ally '
            "<nullify Resistance, unable to remove> [Demerit]",
        )

    def test_trigger_inner_skill_filters_enemy_side_effects(self):
        inner_skills = {
            970480: {
                "id": 970480,
                "functions": [
                    {
                        "funcId": 467,
                        "funcType": "gainNp",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "svals": [{"Rate": 1000, "Value": 3000}],
                    },
                    {
                        "funcId": 470,
                        "funcType": "hastenNpturn",
                        "funcTargetType": "self",
                        "funcTargetTeam": "enemy",
                        "svals": [{"Rate": 1000, "Value": 1}],
                    },
                ],
            },
            970962: {
                "id": 970962,
                "functions": [
                    {
                        "funcId": 727,
                        "funcType": "gainStar",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "svals": [{"Rate": 1000, "Value": 5}],
                    },
                    {
                        "funcId": 214,
                        "funcType": "addStateShort",
                        "funcTargetType": "self",
                        "funcTargetTeam": "enemy",
                        "buffs": [{"id": 159, "type": "upCriticalrate", "name": "Critical Rate Up"}],
                        "svals": [{"Rate": 1000, "Turn": 2, "Count": -1, "Value": 100}],
                    },
                ],
            },
            966456: {
                "id": 966456,
                "functions": [
                    {
                        "funcId": 995,
                        "funcType": "lossNp",
                        "funcTargetType": "self",
                        "funcTargetTeam": "player",
                        "svals": [{"Rate": 1000, "Value": 2000}],
                    },
                    {
                        "funcId": 996,
                        "funcType": "delayNpturn",
                        "funcTargetType": "self",
                        "funcTargetTeam": "enemy",
                        "svals": [{"Rate": 1000, "Value": 1}],
                    },
                ],
            },
            970545: {
                "id": 970545,
                "functions": [
                    {
                        "funcId": 473,
                        "funcType": "delayNpturn",
                        "funcTargetType": "enemy",
                        "funcTargetTeam": "enemy",
                        "svals": [{"Rate": 1000, "Value": 1}],
                    }
                ],
            },
        }
        ctx = FetchContext(fetch_inner_skill=lambda sid: inner_skills.get(sid))

        cagliostro_s2_fn = {
            "funcId": 21385,
            "funcType": "addState",
            "funcTargetType": "self",
            "funcTargetTeam": "player",
            "buffs": [{"id": 5525, "type": "gutsFunction", "name": "Triggers When Guts Activates"}],
            "svals": [{"Rate": 1000, "Turn": 5, "Count": 1, "Value": 970480}],
        }
        self.assertEqual(
            fmt_function(cagliostro_s2_fn, ctx=ctx),
            'Apply a state that "Increase NP Gauge by 30% for yourself" when Guts is activated (1 time, 5 turns) for yourself',
        )

        tamamo_cat_s1_fn = {
            "funcId": 23635,
            "funcType": "addStateShort",
            "funcTargetType": "self",
            "funcTargetTeam": "player",
            "buffs": [{"id": 159, "type": "attackAfterFunction", "name": "Triggers When Attacking"}],
            "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 970962}],
        }
        self.assertEqual(
            fmt_function(tamamo_cat_s1_fn, ctx=ctx),
            'Apply a state that "Gain Critical Stars by 5" when attacking after damage (3 turns) for yourself',
        )

        oberon_s2_fn = {
            "funcId": 21634,
            "funcType": "addState",
            "funcTargetType": "ptOne",
            "funcTargetTeam": "player",
            "buffs": [{"id": 3709, "type": "selfturnendFunction", "name": "Morning Lark"}],
            "svals": [{"Rate": 1000, "Turn": -1, "Count": 1, "Value": 966456}],
        }
        self.assertEqual(
            fmt_function(oberon_s2_fn, ctx=ctx),
            'Inflict Morning Lark <Apply a state that "Decrease NP Gauge by 20% for yourself [Demerit]" at turn end> (1 time) for a single ally',
        )

        ciel_s2_fn = {
            "funcId": 21924,
            "funcType": "addStateShort",
            "funcTargetType": "self",
            "funcTargetTeam": "player",
            "buffs": [
                {
                    "id": 5740,
                    "type": "attackAfterFunction",
                    "name": "Triggers When Attacking",
                    "ckSelfIndv": [{"id": 4001, "name": "cardArts"}],
                }
            ],
            "svals": [{"Rate": 1000, "Turn": 3, "Count": -1, "Value": 970545}],
        }
        self.assertEqual(
            fmt_function(ciel_s2_fn, ctx=ctx),
            'Apply a state that "Decrease Charge for one enemy" when Arts attacking after damage (3 turns) for yourself',
        )

    def test_sub_state_remove_buffs_pluralization(self):
        remove_all_buffs_fn = {
            "funcId": 1001,
            "funcType": "subState",
            "funcTargetType": "enemy",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "traitVals": [{"id": 3004, "name": "buffPositiveEffect"}],
            "buffs": [],
            "svals": [{"Rate": 1000}],
        }
        self.assertEqual(fmt_function(remove_all_buffs_fn), "Remove Buffs for one enemy")
        self.assertEqual(fmt_np_function(remove_all_buffs_fn), "Remove Buffs for one enemy")

        remove_one_buff_fn = {
            **remove_all_buffs_fn,
            "svals": [{"Rate": 1000, "Value2": 1}],
        }
        self.assertEqual(fmt_function(remove_one_buff_fn), "Remove 1 Buff for one enemy")
        self.assertEqual(fmt_np_function(remove_one_buff_fn), "Remove 1 Buff for one enemy")

        remove_atk_buffs_np_fn = {
            "funcId": 1002,
            "funcType": "subState",
            "funcTargetType": "enemyAll",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "traitVals": [{"id": 3006, "name": "buffAtkUp"}],
            "buffs": [],
            "svals": [{"Rate": 1000}],
        }
        self.assertEqual(fmt_np_function(remove_atk_buffs_np_fn), "Remove ATK Buffs for all enemies")

        remove_all_debuffs_fn = {
            "funcId": 1003,
            "funcType": "subState",
            "funcTargetType": "ptAll",
            "funcTargetTeam": "playerAndEnemy",
            "functvals": [],
            "funcquestTvals": [],
            "traitVals": [{"id": 3005, "name": "buffNegativeEffect"}],
            "buffs": [],
            "svals": [{"Rate": 1000}],
        }
        self.assertEqual(fmt_function(remove_all_debuffs_fn), "Remove Debuffs for all allies")
        self.assertEqual(fmt_np_function(remove_all_debuffs_fn), "Remove Debuffs for all allies")

        remove_mental_debuffs_fn = {
            **remove_all_debuffs_fn,
            "traitVals": [{"id": 3010, "name": "buffMentalEffect"}],
        }
        self.assertEqual(fmt_function(remove_mental_debuffs_fn), "Remove Mental Debuffs for all allies")

        remove_one_def_buff_fn = {
            **remove_all_buffs_fn,
            "traitVals": [{"id": 3007, "name": "buffDefUp"}],
            "svals": [{"Rate": 1000, "Value2": 1}],
        }
        self.assertEqual(fmt_function(remove_one_def_buff_fn), "Remove 1 DEF Buff for one enemy")

        remove_def_debuffs_fn = {
            **remove_all_debuffs_fn,
            "traitVals": [{"id": 3009, "name": "buffDefDown"}],
        }
        self.assertEqual(fmt_function(remove_def_debuffs_fn), "Remove DEF Debuffs for all allies")


if __name__ == "__main__":
    unittest.main(verbosity=2)
