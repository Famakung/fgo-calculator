#!/usr/bin/env python3
"""Unit and integration tests for scripts/servant_info_converter and sync_servant_info."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from servant_info_converter.export_servant_info import (  # noqa: E402
    extract_saint_graphs,
    build_servant_info_payload,
    build_skill_by_id,
    build_svt_by_id,
    export_all_servant_info,
)
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
        self.assertIn("passives", fmt)
        self.assertIn("formConfig", fmt)
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

        # Passives exist in both formatted.passives and formatted.slots
        self.assertEqual(len(payload["formatted"]["passives"]), 1)
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
        passive_var = fmt["passives"][0]["variantsByTier"][0]
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
                ("1", "Stage 1", "100100a@1.webp", "ascension"),
                ("2", "Stage 2", "100100a@2.webp", "ascension"),
                ("11", "Summer", "100100b@11.webp", "costume"),
                ("1", "Alt Stage 1", "100100c@1.webp", "form"),
            ],
        )
        self.assertEqual(len(urls), 4)
        self.assertNotIn("https://", json.dumps(entries))
        svt2 = dict(svt, id=600710, relateId={"transform": [100200]})
        self.assertNotIn("form", [e["kind"] for e in extract_saint_graphs(svt2, {100200: partner})[0]])
        svt3 = dict(svt, relateId={"transform": [600710]})
        p710 = dict(partner, id=600710)
        self.assertNotIn("form", [e["kind"] for e in extract_saint_graphs(svt3, {600710: p710})[0]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
