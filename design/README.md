# Design references

`pip-mascot-sandbox.html` is the original interactive sandbox for Pip, the helper
bot mascot, supplied by the project owner. It is a reference only and is not
shipped: it loads Tailwind and fonts from CDNs, which the app itself never does.
The app's version of Pip lives in `src/bot/pip` as a self-contained React
component ported from this file.
