To take new videos use:

$ ffmpeg -i input.mov -vf "fps=12,scale=640:-1" output.gif

This will give small gifs that are easy to embed in READMEs.
