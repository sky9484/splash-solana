import json, importlib.util
spec=importlib.util.spec_from_file_location('iso3','iso3.py'); I=importlib.util.module_from_spec(spec); spec.loader.exec_module(I)
P,box,poly,pts=I.P,I.box,I.poly,I.pts
O=(200,290); S=34
STONE,WHITE,SAND,TEAL,DEEP,INK,MIST,TINT,WATER,AMBER=I.STONE,I.WHITE,I.SAND,I.TEAL,I.DEEP,I.INK,I.MIST,I.TINT,I.WATER,I.AMBER
def shadow(rx=120,ry=30,cy=312): return f'<ellipse cx="200" cy="{cy}" rx="{rx}" ry="{ry}" fill="#1F4452" opacity=".14" filter="url(#blur18)"/>'
def badge(cx,cy,r,fill,kind):
    g=f'<circle cx="{cx}" cy="{cy+6}" r="{r}" fill="#1F4452" opacity=".12" filter="url(#blur6)"/>'
    g+=f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="#FFFFFF" stroke-width="6"/>'
    if kind=='tick': g+=f'<path d="M{cx-r*.42} {cy} L{cx-r*.1} {cy+r*.32} L{cx+r*.45} {cy-r*.3}" fill="none" stroke="#fff" stroke-width="{r*.22}" stroke-linecap="round" stroke-linejoin="round"/>'
    if kind=='x': g+=f'<path d="M{cx-r*.35} {cy-r*.35} L{cx+r*.35} {cy+r*.35} M{cx+r*.35} {cy-r*.35} L{cx-r*.35} {cy+r*.35}" stroke="#fff" stroke-width="{r*.22}" stroke-linecap="round"/>'
    if kind=='clock': g+=f'<path d="M{cx} {cy-r*.5} V{cy} L{cx+r*.38} {cy+r*.24}" fill="none" stroke="#fff" stroke-width="{r*.16}" stroke-linecap="round" stroke-linejoin="round"/>'
    if kind=='bang': g+=f'<path d="M{cx} {cy-r*.5} V{cy+r*.1}" stroke="#fff" stroke-width="{r*.2}" stroke-linecap="round"/><circle cx="{cx}" cy="{cy+r*.42}" r="{r*.11}" fill="#fff"/>'
    return g
def bars_top(x0,y0,z,w,lines,color,width=8):
    out=''
    for (yy,frac) in lines:
        a=P(O,S,x0+0.4,y0+yy,z); b=P(O,S,x0+0.4+w*frac,y0+yy,z)
        out+=f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
    return out
def bars_left(x0,y,z0,w,rows,color,width=7):
    out=''
    for (zz,frac) in rows:
        a=P(O,S,x0+0.35,y,z0+zz); b=P(O,S,x0+0.35+w*frac,y,z0+zz)
        out+=f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
    return out
I3={}
# 01 persona at a desk
g=shadow()
g+=box(O,S,-1.2,-1.0,0,3.4,2.4,0.9,*STONE)
g+=box(O,S,-0.3,-0.6,0.9,1.9,1.3,0.08,*SAND,ao=False)
g+=box(O,S,-0.3,-0.75,0.98,1.9,0.12,1.25,"#E5DCD6","#C9BDB5","#B5A89F")
lid=P(O,S,0.65,-0.69,1.62); g+=f'<circle cx="{lid[0]:.1f}" cy="{lid[1]:.1f}" r="7" fill="#5C9EAD"/>'
hx,hy=P(O,S,-0.9,-1.6,2.9)
body=f'<path d="M{hx-62} {hy+150} C{hx-62} {hy+70} {hx-40} {hy+52} {hx} {hy+52} C{hx+40} {hy+52} {hx+62} {hy+70} {hx+62} {hy+150}Z" fill="#1F4452"/>'
hij=f'<path d="M{hx-46} {hy-6} C{hx-46} {hy-52} {hx-24} {hy-70} {hx} {hy-70} C{hx+24} {hy-70} {hx+46} {hy-52} {hx+46} {hy-6} L{hx+50} {hy+64} C{hx+30} {hy+78} {hx-30} {hy+78} {hx-50} {hy+64}Z" fill="#326273"/>'
face=f'<ellipse cx="{hx}" cy="{hy}" rx="29" ry="33" fill="#E3B99C"/><circle cx="{hx-10}" cy="{hy-2}" r="3.2" fill="#1F4452"/><circle cx="{hx+10}" cy="{hy-2}" r="3.2" fill="#1F4452"/><path d="M{hx-10} {hy+13} Q{hx} {hy+20} {hx+10} {hy+13}" fill="none" stroke="#1F4452" stroke-width="3" stroke-linecap="round"/>'
I3["01-persona-finance-manager"]=shadow()+body+hij+face+g[len(shadow()):]
# 02 bank, slow wire
g=shadow()
g+=box(O,S,-2.2,-1.6,0,4.4,3.2,0.4,*STONE)
for xx in [-1.8,-0.75,0.3,1.35]: g+=box(O,S,xx,0.9,0.4,0.42,0.42,2.6,*WHITE)
g+=box(O,S,-2.2,-1.6,3.0,4.4,3.2,0.35,*INK)
a=P(O,S,-2.2,1.6,3.35); b=P(O,S,2.2,1.6,3.35); c=P(O,S,0,1.6,4.6); d=P(O,S,0,-1.6,4.6); e=P(O,S,2.2,-1.6,3.35)
g+=poly([a,b,c],"#326273")+poly([b,e,d,c],"#24505F")
g+=badge(305,150,46,AMBER,'clock')
I3["02-bank-slow-wire"]=g
# 03 proof wall
g=shadow(130)
rows=[(0,[(-2.4,1.5),(-0.8,1.5),(0.8,1.5)]),(0.75,[(-2.4,0.7),(-1.6,1.5),(0,1.5),(1.6,0.7)]),(1.5,[(-2.4,1.5),(-0.8,1.5),(0.8,1.5)]),(2.25,[(-2.4,0.7),(-1.6,1.5),(0,1.5),(1.6,0.7)])]
for z,bricks in rows:
    for x,w in bricks: g+=box(O,S,x,0,z,w-0.06,1.0,0.7,"#E6DBD3","#CFC3BA","#B5A89F",ao=False)
g+=badge(200,150,48,AMBER,'x')
I3["03-proof-wall"]=g
# 04 email (open envelope, letter inside)
g=shadow()
g+=box(O,S,-2.0,-1.4,0.2,4.0,2.8,0.6,*STONE)
g+=box(O,S,-1.6,-0.9,0.8,3.2,2.0,0.12,"#FFFFFF","#EFE9E5","#DBD1CA",ao=False)
g+=bars_top(-1.6,-0.9,0.93,2.4,[(0.5,0.9),(1.0,0.6)],"#E5DCD6",6)
A=P(O,S,-2.0,-1.4,0.8); B=P(O,S,2.0,-1.4,0.8); M=P(O,S,0.2,-0.2,2.1)
g+=f'<polygon points="{pts(A,M,B)}" fill="#1F4452" opacity=".10" transform="translate(0,10)" filter="url(#blur6)"/>'
g+=poly([A,M,B],"#E6DBD3",'stroke="#CBBFB7" stroke-width="3" stroke-linejoin="round"')
bc=P(O,S,1.9,-1.3,1.6); g+=badge(round(bc[0]),round(bc[1]),22,"#326273",'none')
I3["04-email"]=g
# 05 chat
g=shadow()
g+=box(O,S,-2.0,-1.3,0.6,4.0,2.4,0.45,*STONE)
t1=P(O,S,-1.4,1.1,0.6); t2=P(O,S,-0.6,1.1,0.6); t3=P(O,S,-1.6,1.9,0.0); g+=poly([t1,t2,t3],"#CBBFB7")
g+=bars_top(-2.0,-1.3,1.05,3.2,[(0.6,0.95),(1.2,0.7),(1.8,0.45)],"#CBBFB7",9)
I3["05-chat"]=g
# 06 bank portal
g=shadow(110)
g+=box(O,S,-2.0,0,0,4.0,0.4,3.4,*STONE)
g+=box(O,S,-2.0,0,3.0,4.0,0.42,0.4,*SAND,ao=False)
for xx in [-1.7,-1.35,-1.0]: p=P(O,S,xx,0.42,3.2); g+=f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="5" fill="#FFFFFF"/>'
g+=bars_left(-2.0,0.42,0.6,3.0,[(1.9,0.55),(1.3,0.85),(0.7,0.4)],"#FFFFFF",9)
g+=bars_left(-2.0,0.43,0.6,3.0,[(0.3,0.3)],"#326273",14)
I3["06-bank-portal"]=g
# 07 phone screenshot
g=shadow(90)
g+=box(O,S,-0.8,0,0,1.8,0.3,3.8,*INK)
g+=box(O,S,-0.62,0.3,0.25,1.44,0.02,3.3,"#E7EEF1","#E7EEF1","#E7EEF1",ao=False,sheen=False,edge=False)
s0=P(O,S,-0.45,0.32,2.6); g+=f'<polygon points="{s0[0]:.1f},{s0[1]:.1f} {s0[0]+33:.1f},{s0[1]+19:.1f} {s0[0]+33:.1f},{s0[1]+52:.1f} {s0[0]:.1f},{s0[1]+33:.1f}" fill="#FFFFFF"/>'
g+=bars_left(-0.8,0.32,0.6,1.1,[(1.6,0.9),(1.2,0.6),(0.8,0.75)],"#C9BDB5",7)
I3["07-phone-screenshot"]=g
# 08 receipt verified
g=shadow(100)
g+=box(O,S,-1.3,0,0,2.6,0.16,4.0,*WHITE)
top=[P(O,S,-1.3+0.26*i,0.16,4.0+(0.18 if i%2 else 0)) for i in range(11)]
g+=f'<polyline points="{pts(*top)}" fill="none" stroke="#E5DCD6" stroke-width="4"/>'
g+=bars_left(-1.3,0.17,0.6,2.0,[(2.9,0.9),(2.4,0.6),(1.9,0.75)],"#E5DCD6",9)
g+=bars_left(-1.3,0.17,0.6,2.0,[(1.2,0.45)],"#326273",11)
g+=badge(282,212,44,"#5C9EAD",'tick')
I3["08-receipt-verified"]=g
# 09 vault + shield
g=shadow()
g+=box(O,S,-1.8,-1.8,0,3.6,3.6,3.4,*DEEP)
c=P(O,S,0,1.8,1.7)
g+=f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="40" ry="46" transform="rotate(-30 {c[0]:.1f} {c[1]:.1f})" fill="#1F4452"/>'
g+=f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="26" ry="30" transform="rotate(-30 {c[0]:.1f} {c[1]:.1f})" fill="#4C8293"/><circle cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="8" fill="#E5DCD6"/>'
g+=f'<circle cx="300" cy="236" r="44" fill="#1F4452" opacity=".12" filter="url(#blur6)"/><path d="M300 165 l42 16 v32 c0 30-18 50-42 60 c-24-10-42-30-42-60 v-32z" fill="#5C9EAD" stroke="#fff" stroke-width="6"/><path d="M282 214 L296 228 L320 200" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
I3["09-vault-shield"]=g
# 10 wallet leak (crypto wallet: no approvals, coins falling out)
def coin(x,y,z,r=0.34,th=4):
    c=P(O,S,x,y,z); rx=r*S*0.9; ry=r*S*0.45
    return (f'<ellipse cx="{c[0]:.1f}" cy="{c[1]+th:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="#3F7D8E"/>'
            f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="#5C9EAD"/>'
            f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="{rx*0.55:.1f}" ry="{ry*0.55:.1f}" fill="none" stroke="#9CC3CD" stroke-width="2.5"/>')
g=shadow()
g+=box(O,S,-2.1,-1.2,0,3.4,2.4,0.8,*SAND)
g+=box(O,S,-2.1,-1.2,0.8,3.4,1.2,0.2,"#D1C5BC","#B9ACA2","#A2968D",ao=False)
g+=box(O,S,0.5,-0.5,1.0,0.5,0.5,0.14,*TEAL,ao=False)
g+=coin(1.9,0.0,1.1)+coin(2.4,0.5,0.7)+coin(2.0,1.2,0.3)+coin(2.8,1.1,0.0)
g+=badge(112,140,40,AMBER,'bang')
I3["10-wallet-leak"]=g
# 11 forwarder truck with container
g=shadow(140)
for xx in (-1.4,-0.6,1.6): g+=box(O,S,xx,0.95,0,0.6,0.25,0.5,*INK,ao=False,sheen=False,edge=False)
g+=box(O,S,-2.2,-0.1,0.45,4.6,1.2,0.25,*SAND)
g+=box(O,S,-2.0,0,0.7,2.9,1.0,1.0,*TEAL)
g+=I.mullions(O,S,-2.0,0,0.7,2.9,1.0,1.0,6,"#1F4452",.18)
g+=box(O,S,1.2,-0.1,0.7,1.2,1.2,1.15,*INK)
win=[P(O,S,2.4,0.1,1.2),P(O,S,2.4,1.0,1.2),P(O,S,2.4,1.0,1.7),P(O,S,2.4,0.1,1.7)]; g+=poly(win,"#9CC3CD")
I3["11-forwarder-truck"]=g
# 12 approve on device (coral moment)
g=shadow(90)
g+=box(O,S,-0.8,0,0,1.8,0.3,3.8,*INK)
g+=box(O,S,-0.62,0.3,0.25,1.44,0.02,3.3,"#FFFFFF","#FFFFFF","#FFFFFF",ao=False,sheen=False,edge=False)
g+=bars_left(-0.8,0.32,0.6,1.1,[(2.6,0.9),(2.2,0.5),(1.8,0.7)],"#E5DCD6",7)
btn=[P(O,S,-0.5,0.33,0.75),P(O,S,0.5,0.33,0.75),P(O,S,0.5,0.33,1.25),P(O,S,-0.5,0.33,1.25)]; g+=poly(btn,"#E39774",'rx="4"')
g+=badge(292,150,40,"#2E7D6B",'tick')
I3["12-approve-on-device"]=g
json.dump(I3,open('isoicons3.json','w')); print(len(I3))
