## Repository contents

This repository contains:
- the visualization frontend
- integration logic for CpeeDiff and XYDiff results
- scripts for generating diff output and viewer input data
- modified CpeeDiff implementation (for now)

This repository does not include the following external dependencies:
- cpee-layout
- XYDiff implementation
- XYDiff binary/executable

## Setup

Clone this repository and place the external dependencies next to it in the following structure:

```text
masterthesis/
  cpee-layout/
  cpeediff/
  xydiff/
  xydiff-bin/
  src/
```

## External dependencies

This project was produced with the following exact revisions:

### cpee-layout
Repository: https://github.com/etm/cpee-layout
Commit: `796037c3efcf0e1e970a2032d2787019d283aef3`

### cpeediff
Repository: https://github.com/Toemmsche/cpeediff
Commit: `9e10e547eb70ca2a1aa4434c97c64e8ea866f73a`

### xydiff
Repository: https://github.com/fdintino/xydiff
Commit: `56058f18d0a102d2c446f36fa2a1cf95f295ef0a`