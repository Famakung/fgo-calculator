#!/usr/bin/env python3
"""
update_traits.py — Servant traits update utility for FGO Calculator.

Easily add, remove, set, or view servant traits in src/scripts/data/servants.js.
Maintains ascending sort order and standard formatting.

Examples:
    python .claude/docs/update_traits.py add -s "427,075,373,311,298" -t 2780
    python .claude/docs/update_traits.py add -s 482 -t "[Gender:Male], [Class:Berserker]"
    python .claude/docs/update_traits.py remove -s 075 -t 2780
    python .claude/docs/update_traits.py set -s 482 -t "0001,0002,0106,0202,0302,0304,0405"
    python .claude/docs/update_traits.py view -s 482,075
    python .claude/docs/update_traits.py list-traits -q dress
    python .claude/docs/update_traits.py  # Interactive mode
"""

import os
import sys
import re
import argparse

# Ensure standard UTF-8 console output if supported
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Path Configuration
# ---------------------------------------------------------------------------
DOCS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(DOCS_DIR, "..", ".."))
SERVANTS_FILE = os.path.join(ROOT_DIR, "src", "scripts", "data", "servants.js")
TRAITS_FILE = os.path.join(ROOT_DIR, "src", "scripts", "data", "traits.js")


# ---------------------------------------------------------------------------
# Trait Dictionary & Parsing
# ---------------------------------------------------------------------------
def load_traits(traits_path=TRAITS_FILE):
    """
    Parses TRAIT_DATA from traits.js into:
      trait_map: {trait_id: display_name}
      name_to_id: {normalized_name: trait_id}
    """
    trait_map = {}
    name_to_id = {}

    if not os.path.exists(traits_path):
        return trait_map, name_to_id

    with open(traits_path, "r", encoding="utf-8") as f:
        content = f.read()

    for m in re.finditer(r'["\']?([0-9]+)["\']?\s*:\s*["\']([^"\']+)["\']', content):
        raw_id = m.group(1)
        name = m.group(2)

        # Standard 4-digit zero-padding for traits under 10000
        tid = raw_id.zfill(4) if len(raw_id) < 4 else raw_id
        trait_map[tid] = name

        # Normalized search token (alphanumeric lowercase)
        clean = re.sub(r"[^a-z0-9]", "", name.lower())
        name_to_id[clean] = tid

        # Inverted names e.g. "Attribute Human" <-> "Human Attribute"
        parts = name.lower().split()
        if len(parts) == 2:
            name_to_id[parts[1] + parts[0]] = tid
        elif len(parts) == 3:
            name_to_id[parts[1] + parts[2] + parts[0]] = tid

    # Common aliases and variations
    aliases = {
        "spiritondress": "2780",
        "spiritondresses": "2780",
        "spiritrondress": "2780",
        "spiritrondresses": "2780",
        "costume": "2780",
        "dress": "2780",
        "dresses": "2780",
        "modernhuman": "2654",
        "beastservant": "2821",
        "beastservants": "2821",
        "animal": "2821",
        "animals": "2821",
        "solomon": "2801200",
    }
    for alias, tid in aliases.items():
        if alias not in name_to_id and tid in trait_map:
            name_to_id[alias] = tid

    return trait_map, name_to_id


def parse_trait_tokens(input_str, trait_map, name_to_id):
    """
    Parses a string of trait IDs, names, or [Category:Value] representations.
    Returns a sorted list of unique trait IDs.
    """
    results = []

    # Extract bracketed items [foo] or split by comma
    if "[" in input_str and "]" in input_str:
        raw_items = re.findall(r"\[([^\]]+)\]", input_str)
    else:
        raw_items = [x.strip() for x in input_str.split(",") if x.strip()]

    for raw in raw_items:
        val = raw.strip("\"' ")
        if not val:
            continue

        clean_val = val.strip("\"',")

        # 1. Direct numeric ID
        if clean_val.isdigit():
            tid = clean_val.zfill(4) if len(clean_val) <= 3 else clean_val
            if tid in trait_map:
                results.append(tid)
                continue
            elif clean_val in trait_map:
                results.append(clean_val)
                continue
            else:
                results.append(tid)
                continue

        # 2. Normalized alphanumeric match
        norm = re.sub(r"[^a-z0-9]", "", val.lower())
        if norm in name_to_id:
            results.append(name_to_id[norm])
        elif norm.rstrip("s") in name_to_id:
            results.append(name_to_id[norm.rstrip("s")])
        elif (norm + "s") in name_to_id:
            results.append(name_to_id[norm + "s"])
        else:
            # Substring match fallback
            matched = False
            for k, tid in name_to_id.items():
                if norm and (norm in k or k in norm):
                    results.append(tid)
                    matched = True
                    break
            if not matched:
                print(f"[Warning] Could not resolve trait '{val}'. Skipping.")

    # Unique and sorted numerically
    return sorted(list(set(results)), key=lambda x: (int(x) if x.isdigit() else float("inf"), x))


# ---------------------------------------------------------------------------
# Servant Entry Locator & Manipulation
# ---------------------------------------------------------------------------
def locate_servant_entry(lines, servant_id):
    """
    Finds start and end line indices (0-based) for a servant ID in lines list.
    Supports padded ("075") and unpadded ("75") string or numeric keys.
    """
    clean_id = str(servant_id).strip("\"' ")
    keys_to_match = {clean_id}
    if clean_id.isdigit():
        num = int(clean_id)
        keys_to_match.add(str(num))
        keys_to_match.add(str(num).zfill(3))

    start_idx = None
    end_idx = None

    for i, line in enumerate(lines):
        m = re.match(r'^\s{2}["\']?([0-9a-zA-Z_-]+)["\']?\s*:\s*\{', line)
        if m:
            matched_key = m.group(1)
            is_match = False
            if matched_key in keys_to_match:
                is_match = True
            elif matched_key.isdigit() and clean_id.isdigit() and int(matched_key) == int(clean_id):
                is_match = True

            if is_match:
                start_idx = i
                # Single-line entry ends with '},' or '}' on same line
                if line.rstrip().endswith(("},", "}")):
                    end_idx = i
                    break
                continue

        if start_idx is not None and i > start_idx:
            # Multi-line entry closing: either '  },' or start of next entry
            if re.match(r'^\s{2}\},?\s*$', line) or re.match(r'^\s{2}["\']?[0-9a-zA-Z_-]+["\']?\s*:\s*\{', line):
                if re.match(r'^\s{2}\},?\s*$', line):
                    end_idx = i
                else:
                    end_idx = i - 1
                break

    if start_idx is not None and end_idx is None:
        end_idx = len(lines) - 1

    return start_idx, end_idx


def get_servant_info(lines, start_idx, end_idx, target_asc="base"):
    """
    Extracts servant name and current traits for target_asc.
    """
    entry_text = "".join(lines[start_idx : end_idx + 1])
    name_m = re.search(r'name:\s*["\']([^"\']+)["\']', entry_text)
    name = name_m.group(1) if name_m else "Unknown"

    traits = []
    for idx in range(start_idx, end_idx + 1):
        m = re.search(r'(\b' + re.escape(target_asc) + r':\s*\[)(.*?)(\])', lines[idx])
        if m:
            traits = re.findall(r'["\']([0-9a-zA-Z]+)["\']', m.group(2))
            break

    return name, traits


def modify_servant_traits(lines, servant_id, new_traits, action="add", target_asc="base"):
    """
    Applies action ('add', 'remove', 'set') to servant_id's traits in lines list.
    Returns (success: bool, message: str, details: dict).
    """
    start_idx, end_idx = locate_servant_entry(lines, servant_id)
    if start_idx is None:
        return False, f"Servant ID '{servant_id}' not found in servants.js.", {}

    servant_name, current_traits = get_servant_info(lines, start_idx, end_idx, target_asc)

    # Locate ascension line
    asc_line_idx = None
    asc_match = None
    for idx in range(start_idx, end_idx + 1):
        m = re.search(r'(\b' + re.escape(target_asc) + r':\s*\[)(.*?)(\])', lines[idx])
        if m:
            asc_line_idx = idx
            asc_match = m
            break

    if not asc_match:
        # If adding/setting to an ascension that doesn't exist yet
        if action in ("add", "set"):
            traits_line_idx = None
            traits_m = None
            for idx in range(start_idx, end_idx + 1):
                tm = re.search(r'(\btraits\s*:\s*\{)(.*?)(\})', lines[idx])
                if tm:
                    traits_line_idx = idx
                    traits_m = tm
                    break

            if traits_m:
                sorted_traits = sorted(
                    list(set(new_traits)), key=lambda x: (int(x) if x.isdigit() else float("inf"), x)
                )
                arr_str = "[" + ", ".join(f'"{t}"' for t in sorted_traits) + "]"
                asc_key = f'"{target_asc}"' if target_asc.isdigit() and len(target_asc) == 3 else target_asc
                insertion = f", {asc_key}: {arr_str}"

                orig = lines[traits_line_idx]
                lines[traits_line_idx] = (
                    orig[: traits_m.start(1)]
                    + traits_m.group(1)
                    + traits_m.group(2).rstrip()
                    + insertion
                    + "}"
                    + orig[traits_m.end(3) :]
                )
                return True, f"Created '{target_asc}' ascension with traits {sorted_traits} for {servant_name}.", {}
            else:
                return False, f"Could not locate traits block in servant '{servant_id}'.", {}
        else:
            return False, f"Ascension key '{target_asc}' not found in servant '{servant_id}'.", {}

    # Calculate new trait set
    old_set = set(current_traits)
    new_set = set(new_traits)

    if action == "add":
        final_set = old_set.union(new_set)
    elif action == "remove":
        final_set = old_set.difference(new_set)
    elif action == "set":
        final_set = new_set
    else:
        return False, f"Invalid action '{action}'.", {}

    sorted_traits = sorted(list(final_set), key=lambda x: (int(x) if x.isdigit() else float("inf"), x))
    arr_str = "[" + ", ".join(f'"{t}"' for t in sorted_traits) + "]"

    orig_line = lines[asc_line_idx]
    lines[asc_line_idx] = orig_line[: asc_match.start(1)] + f"{target_asc}: {arr_str}" + orig_line[asc_match.end(3) :]

    added = [t for t in sorted_traits if t not in old_set]
    removed = [t for t in old_set if t not in sorted_traits]

    details = {
        "id": servant_id,
        "name": servant_name,
        "ascension": target_asc,
        "old": current_traits,
        "new": sorted_traits,
        "added": added,
        "removed": removed,
    }

    status = "No changes needed" if not added and not removed else "Updated"
    msg = f"[{servant_id}] {servant_name} ({target_asc}): {status} (added: {added}, removed: {removed})"
    return True, msg, details


def create_new_servant(lines, servant_id, name, traits, target_asc="base"):
    """
    Creates a new servant entry before the closing '};' of SERVANT_DATA.
    """
    sorted_traits = sorted(list(set(traits)), key=lambda x: (int(x) if x.isdigit() else float("inf"), x))
    arr_str = "[" + ", ".join(f'"{t}"' for t in sorted_traits) + "]"

    key_repr = f'"{servant_id}"' if "-" in servant_id else servant_id
    new_entry = f'  {key_repr}: {{ name: "{name}", traits: {{ {target_asc}: {arr_str} }} }},\n'

    # Find last line with closing '};'
    close_idx = None
    for i in range(len(lines) - 1, -1, -1):
        if re.match(r"^\s*\};\s*$", lines[i]):
            close_idx = i
            break

    if close_idx is not None:
        lines.insert(close_idx, new_entry)
        return True, f"Created new servant [{servant_id}] {name} with traits: {sorted_traits}"
    else:
        return False, "Could not find closing '};' in servants.js."


# ---------------------------------------------------------------------------
# CLI Commands
# ---------------------------------------------------------------------------
def parse_servant_ids(input_str):
    """Parses comma or space-separated servant IDs."""
    if not input_str:
        return []
    # Replace whitespace with comma then split
    cleaned = re.sub(r"\s+", ",", input_str.strip())
    return [s.strip("\"' ") for s in cleaned.split(",") if s.strip("\"' ")]


def execute_action(args, trait_map, name_to_id):
    if not os.path.exists(SERVANTS_FILE):
        print(f"[Error] File not found: {SERVANTS_FILE}")
        return 1

    with open(SERVANTS_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # --- ACTION: LIST TRAITS ---
    if args.action == "list-traits":
        query = (args.query or "").lower()
        print(f"\n{'ID':<10} {'Name':<30}")
        print("-" * 40)
        for tid, tname in sorted(trait_map.items(), key=lambda x: (int(x[0]) if x[0].isdigit() else float("inf"), x[0])):
            if not query or query in tid.lower() or query in tname.lower():
                print(f"{tid:<10} {tname:<30}")
        return 0

    servant_ids = parse_servant_ids(getattr(args, "servants", None))
    if not servant_ids:
        print("[Error] No servant IDs provided. Use -s/--servants.")
        return 1

    # --- ACTION: VIEW ---
    if args.action == "view":
        for sid in servant_ids:
            s_idx, e_idx = locate_servant_entry(lines, sid)
            if s_idx is None:
                print(f"[!] Servant ID '{sid}' not found.")
                continue
            name, traits = get_servant_info(lines, s_idx, e_idx, args.ascension)
            print(f"\n[{sid}] {name}")
            print(f"  Ascension: {args.ascension}")
            print(f"  Traits ({len(traits)}): {traits}")
            for t in traits:
                t_name = trait_map.get(t, "Unknown trait")
                print(f"    - {t}: {t_name}")
        return 0

    # --- ACTION: ADD / REMOVE / SET ---
    if not args.traits:
        print("[Error] No traits provided. Use -t/--traits.")
        return 1

    parsed_traits = parse_trait_tokens(args.traits, trait_map, name_to_id)
    if not parsed_traits:
        print(f"[Error] Could not parse any valid traits from: '{args.traits}'")
        return 1

    print(f"\nResolved Trait IDs ({len(parsed_traits)}): {parsed_traits}")
    for t in parsed_traits:
        print(f"  - {t}: {trait_map.get(t, 'Custom trait')}")
    print()

    modified_count = 0
    for sid in servant_ids:
        ok, msg, details = modify_servant_traits(lines, sid, parsed_traits, action=args.action, target_asc=args.ascension)
        if ok:
            print(f"  [OK] {msg}")
            if details.get("added") or details.get("removed") or args.action == "set":
                modified_count += 1
        else:
            if getattr(args, "create", False) and args.action in ("add", "set"):
                name = getattr(args, "name", None) or f"Servant {sid}"
                c_ok, c_msg = create_new_servant(lines, sid, name, parsed_traits, target_asc=args.ascension)
                if c_ok:
                    print(f"  [+] {c_msg}")
                    modified_count += 1
                else:
                    print(f"  [!] {c_msg}")
            else:
                print(f"  [!] {msg}")

    if args.dry_run:
        print("\n[Dry Run] Changes not written to file.")
        return 0

    if modified_count > 0:
        with open(SERVANTS_FILE, "w", encoding="utf-8") as f:
            f.writelines(lines)
        print(f"\nSuccessfully updated {modified_count} servant entry(s) in {SERVANTS_FILE}.")
    else:
        print("\nNo entries modified.")

    return 0


# ---------------------------------------------------------------------------
# Interactive Prompt
# ---------------------------------------------------------------------------
def run_interactive(trait_map, name_to_id):
    print("=" * 60)
    print(" FGO Calculator — Servant Traits Update Utility (Interactive)")
    print("=" * 60)

    print("\nSelect Action:")
    print("  [1] Add trait(s) to servant(s)")
    print("  [2] Remove trait(s) from servant(s)")
    print("  [3] Set/replace traits for a servant")
    print("  [4] View servant traits")
    print("  [5] Search/list registered traits")
    print("  [0] Exit")

    choice = input("\nChoice (1-5, 0 to exit): ").strip()
    actions = {"1": "add", "2": "remove", "3": "set", "4": "view", "5": "list-traits", "0": "exit"}
    action = actions.get(choice)

    if not action or action == "exit":
        print("Exiting.")
        return

    if action == "list-traits":
        q = input("Search query (or press Enter for all): ").strip()
        args = argparse.Namespace(action="list-traits", query=q, servants=None, traits=None, ascension="base", dry_run=False, create=False, name=None)
        execute_action(args, trait_map, name_to_id)
        return

    servants_in = input("Enter Servant ID(s) (comma-separated, e.g. 427, 075, 373): ").strip()
    if not servants_in:
        print("No servant IDs provided. Aborting.")
        return

    asc_in = input("Ascension key (press Enter for default 'base'): ").strip()
    ascension = asc_in if asc_in else "base"

    traits_in = ""
    if action in ("add", "remove", "set"):
        traits_in = input("Enter Trait(s) (IDs, names, or [Bracket] format, e.g. 2780, [Class:Berserker]): ").strip()
        if not traits_in:
            print("No traits entered. Aborting.")
            return

    args = argparse.Namespace(
        action=action,
        servants=servants_in,
        traits=traits_in,
        ascension=ascension,
        dry_run=False,
        create=False,
        name=None,
        query=None,
    )
    execute_action(args, trait_map, name_to_id)


# ---------------------------------------------------------------------------
# Main Entry Point
# ---------------------------------------------------------------------------
def main():
    trait_map, name_to_id = load_traits()

    parser = argparse.ArgumentParser(
        description="FGO Calculator Servant Traits Update Utility",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    subparsers = parser.add_subparsers(dest="action", help="Action to perform")

    # Common servant args
    def add_common_args(sub):
        sub.add_argument("-s", "--servants", help="Servant ID(s), e.g. '427,075,373,311,298'")
        sub.add_argument("-t", "--traits", help="Trait ID(s) or names, e.g. '2780' or '[Gender:Male],[Class:Berserker]'")
        sub.add_argument("-a", "--ascension", default="base", help="Target ascension key (default: 'base')")
        sub.add_argument("--dry-run", action="store_true", help="Preview changes without writing to file")

    # Add
    parser_add = subparsers.add_parser("add", help="Add trait(s) to servant(s)")
    add_common_args(parser_add)
    parser_add.add_argument("--create", action="store_true", help="Create new servant if ID does not exist")
    parser_add.add_argument("--name", help="Servant name (if creating new servant)")

    # Remove
    parser_remove = subparsers.add_parser("remove", help="Remove trait(s) from servant(s)")
    add_common_args(parser_remove)

    # Set
    parser_set = subparsers.add_parser("set", help="Set/replace entire trait list for servant(s)")
    add_common_args(parser_set)
    parser_set.add_argument("--create", action="store_true", help="Create new servant if ID does not exist")
    parser_set.add_argument("--name", help="Servant name (if creating new servant)")

    # View
    parser_view = subparsers.add_parser("view", help="View traits of servant(s)")
    parser_view.add_argument("-s", "--servants", required=True, help="Servant ID(s) to view")
    parser_view.add_argument("-a", "--ascension", default="base", help="Target ascension (default: 'base')")

    # List traits
    parser_list = subparsers.add_parser("list-traits", help="List or search registered traits")
    parser_list.add_argument("-q", "--query", help="Filter traits by ID or name keyword")

    # Interactive flag
    parser.add_argument("-i", "--interactive", action="store_true", help="Run in interactive wizard mode")

    if len(sys.argv) == 1:
        run_interactive(trait_map, name_to_id)
        return

    args = parser.parse_args()
    if args.interactive:
        run_interactive(trait_map, name_to_id)
        return

    if not args.action:
        parser.print_help()
        return

    sys.exit(execute_action(args, trait_map, name_to_id))


if __name__ == "__main__":
    main()
