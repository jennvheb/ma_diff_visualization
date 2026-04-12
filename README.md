## Repository contents

This repository contains:
- the visualization frontend
- integration logic for CpeeDiff and XYDiff
- scripts for generating diff output and viewer input data

This repository does not include the following external dependencies:
- cpee-layout
- XYDiff implementation
- XYDiff binary/executable
- modified CpeeDiff implementation

## Setup

Clone this repository and place the external dependencies next to it in the following structure:

```text
ma_diff_visualization/
  cpee-layout/
  cpeediff/
  xydiff/
  xydiff-bin/
  src/
```

## External dependencies

This project was produced with the following exact versions. Please clone them and place them in the order above.

### cpee-layout
Repository: https://github.com/etm/cpee-layout  
Commit: `796037c3efcf0e1e970a2032d2787019d283aef3`

### cpeediff
Repository: https://github.com/jennvheb/cpeediff

### xydiff
Repository: https://github.com/fdintino/xydiff  
Commit: `56058f18d0a102d2c446f36fa2a1cf95f295ef0a`

This project requires the XYDiff binary to be compiled locally! Please generate it.

## Running the viewer

place testsets into viewer/testset, set them as OLD/NEW in main.js and run in the viewer directory:
```
node main.js --algo=xydiff 
``` 
or  
```
node main.js --algo=cpeediff --anchor=endpoint  
``` 
or  
```
node main.js --algo=cpeediff --anchor=id  
``` 
or  
```
node main.js --algo=cpeediff --anchor=label  
  ```
then open the index.html  

## Using the endpoint
Go to the /src/run folder and run
```
node server.js 
```
then call 
```
curl -X POST http://localhost:3000/diff \
  -F "old=@./testset/testfile1.xml" \
  -F "new=@./testset/testfile2.xml" \
  -F "algo=[cpeediff or xydiff]" \
  -F "anchors=[anchor choice for cpeediff]"
```
while changing the filenames and paths to the files you want to diff on. The returned output is: diffSource, diffOps, rawDiffXml, oldTreeXml, newTreeXml