"""Synthetic pagination fixture and assertions against the actual PDF text map."""


def markdown():
    sections = ["LEFT_MARGIN_PROOF\n"]
    for number in range(24):
        lines = [f"PARA_{number:02d}_START This short paragraph belongs together."]
        lines += [f"Line {line} of paragraph {number} stays readable." for line in range(6)]
        lines += [f"PARA_{number:02d}_END The final line belongs to this paragraph."]
        sections += ["#" * (number % 6 + 1) + f" HEADING_{number:02d}", "\n".join(lines)]
    sections += ["## CODE_HEADING", "```text\nCODE_START\n" + "\n".join(f"code line {line}" for line in range(10)) + "\nCODE_END\n```"]
    sections += ["## LONG_HEADING", "LONG_START\n" + "\n".join(f"LONG_LINE_{line:03d} must remain complete." for line in range(70)) + "\nLONG_END"]
    sections += ["END_OF_DOCUMENT_PROOF"]
    return "\n\n".join(sections) + "\n"


def inspect(pages):
    locations = {}
    for index, page in enumerate(pages):
        for word in page.findall(".//{*}word"):
            locations.setdefault(word.text, set()).add(index)
    problems = []
    for number in range(24):
        heading, start, end = (f"HEADING_{number:02d}", f"PARA_{number:02d}_START", f"PARA_{number:02d}_END")
        assert all(token in locations for token in [heading, start, end]), f"Lost paragraph {number}"
        if locations[heading] != locations[start]:
            problems.append(f"orphan heading {heading}: {locations[heading]} vs {locations[start]}")
        if locations[start] != locations[end]:
            problems.append(f"short paragraph split {number}: {locations[start]} vs {locations[end]}")
    assert all(token in locations for token in ["CODE_HEADING", "CODE_START", "CODE_END", "LONG_START", "LONG_END", "END_OF_DOCUMENT_PROOF"])
    if locations["CODE_HEADING"] != locations["CODE_START"] or locations["CODE_START"] != locations["CODE_END"]:
        problems.append("short code block or its heading split across pages")
    assert all(f"LONG_LINE_{line:03d}" in locations for line in range(70)), "An oversized paragraph lost lines"
    if locations["LONG_HEADING"] != locations["LONG_START"]:
        problems.append("heading separated from oversized paragraph start")
    assert locations["LONG_START"] != locations["LONG_END"], "An oversized paragraph must paginate, not clip"
    return problems
