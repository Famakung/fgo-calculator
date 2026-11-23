"""Unofficial English for JP-only content not yet localized in NA.

Both sync_atlas_data.py and the servant-info converter regenerate data, so the
maps live in one module: an override kept in only one of them would be
overwritten by the other's output on the next sync.
"""

# Servants, keyed by Atlas id and collectionNo (the sync looks up either).
SERVANT_NAMES = {
    "483": "Tamamo Aria",
    "406000": "Tamamo Aria",
    "705400": "Daedalus",
    "482": "Daedalus",
    "2801400": "Himiko & Iyo",
    "484": "Himiko & Iyo",
    "705500": "Matsunaga Hisahide",
    "486": "Matsunaga Hisahide",
    "2501700": "Dynamite Rikyu",
    "487": "Dynamite Rikyu",
}

# Atlas `overWriteServantName` values (per-ascension names) still in Japanese.
ASCENSION_NAMES = {
    "キューティ駒": "Cutie Koma",
}

# Costume labels, keyed by battleCharaId/costume id or by the JP `shortName`.
# The sync writes them into servants.js optionLabels; the converter into
# public/servant_info/<id>.json saintGraphs labels.
COSTUME_LABELS = {
    "301330": "Piercing Bunny",
    "102830": "Decapitating Bunny (First Ascension)",
    "102840": "Decapitating Bunny (Second Ascension)",
    "102850": "Decapitating Bunny (Third Ascension)",
    "702830": "Mad Bunny",
    "204330": "Bloody Bunny",
    "1101630": "Serious Mode",
    "4000130": "Earth President",
    "2301130": "Incognito Glasses",
    "600730": "Red Hood & Big Bad Wolf",
    "レッドフード＆ビッグバッドウルフ": "Red Hood & Big Bad Wolf",
    "ボンバー☆ギャル": "Bomber☆Gal",
    "笠・オフ・Re/Q": "Kasa Off Re/Q",
}

# Craft Essences, keyed by CE id.
CE_NAMES = {
    "2583": "Great Library of Memories",
    "9409210": "Great Library of Memories",
    "2607": "Sword Saints of Wandering",
    "9409320": "Sword Saints of Wandering",
    "2701": "Gun Dealer",
    "9409490": "Gun Dealer",
}

# CE series titles, keyed by Atlas series name.
SERIES_NAMES = {
    "Twilight Portrait": "Heroic Spirit Encounter",
    "英霊逢魔": "Heroic Spirit Encounter",
}