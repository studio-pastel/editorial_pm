"""Builds the single-file board (index.html) from the parts in this folder.

usage: python3 src/build.py <relay web-app URL> <OAuth client ID> [output path, default: index.html at the repository root]
"""
import sys, pathlib
here = pathlib.Path(__file__).parent
relay = sys.argv[1] if len(sys.argv) > 1 else '__RELAY_URL__'
cid = sys.argv[2] if len(sys.argv) > 2 else '__CLIENT_ID__'
out = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else here.parent / 'index.html'
files = ['g3_core.js', 'g4_relay.js', 'g5_store.js', 'g6_board.js', 'g7a_three.js', 'g7b_three.js', 'g8_project.js', 'g10_pm.js', 'g11_work.js', 'g9_main.js']
js = ''.join((here / f).read_text(encoding='utf-8') + '\n' for f in files)
js = js.replace("if (typeof module !== 'undefined') {", "if (false) {")
js = js.replace("relayUrl: '__RELAY_URL__'", "relayUrl: '" + relay + "'").replace("clientId: '__CLIENT_ID__'", "clientId: '" + cid + "'")
html = (here / 'g1_head.html').read_text(encoding='utf-8') + (here / 'g2_body.html').read_text(encoding='utf-8') + '<script>\n' + js + '</script>\n</body>\n</html>\n'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding='utf-8')
print(out, len(html))
