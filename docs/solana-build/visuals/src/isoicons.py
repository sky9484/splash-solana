import json, math, importlib.util
spec=importlib.util.spec_from_file_location('iso','iso.py'); iso=importlib.util.module_from_spec(spec); spec.loader.exec_module(iso)
P,poly,box=iso.P,iso.poly,iso.box
STONE=iso.STONE; WHITE=iso.WHITE; TEAL=iso.TEAL; SAND=iso.SAND; INK=iso.INK
MIST=("#E7EEF1","#D3E0E5","#B9CDD4"); TINT=("#9CC3CD","#7FAEBA","#5C9EAD"); AMBER="#B4690E"
O=(200,290); S=34
def shadow(rx=120,ry=34,cy=300): return f'<ellipse cx="200" cy="{cy}" rx="{rx}" ry="{ry}" fill="#E5DCD6" opacity=".7"/>'
def badge(cx,cy,r,fill,kind):
    g=f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="#FFFFFF" stroke-width="6"/>'
    if kind=='tick': g+=f'<path d="M{cx-r*.42} {cy} L{cx-r*.1} {cy+r*.32} L{cx+r*.45} {cy-r*.3}" fill="none" stroke="#fff" stroke-width="{r*.22}" stroke-linecap="round" stroke-linejoin="round"/>'
    if kind=='x': g+=f'<path d="M{cx-r*.35} {cy-r*.35} L{cx+r*.35} {cy+r*.35} M{cx+r*.35} {cy-r*.35} L{cx-r*.35} {cy+r*.35}" stroke="#fff" stroke-width="{r*.22}" stroke-linecap="round"/>'
    if kind=='clock': g+=f'<path d="M{cx} {cy-r*.5} V{cy} L{cx+r*.38} {cy+r*.24}" fill="none" stroke="#fff" stroke-width="{r*.16}" stroke-linecap="round" stroke-linejoin="round"/>'
    return g
def face_lines_top(x0,y0,z,w,lines,color,width=8):  # rounded bars on a top face, along x
    out=''
    for (yy,frac) in lines:
        a=P(O,S,x0+0.4,y0+yy,z); b=P(O,S,x0+0.4+w*frac,y0+yy,z)
        out+=f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
    return out
def face_lines_left(x0,y,z0,w,rows,color,width=7):  # bars on the +y face, horizontal along x
    out=''
    for (zz,frac) in rows:
        a=P(O,S,x0+0.35,y,z0+zz); b=P(O,S,x0+0.35+w*frac,y,z0+zz)
        out+=f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
    return out
I={}
# 1 persona at a desk
g=shadow()
g+=box(O,S,-1.2,-1.0,0,3.4,2.4,0.9,*STONE)                     # desk
g+=box(O,S,-0.3,-0.6,0.9,1.9,1.3,0.08,*SAND)                   # laptop base
g+=box(O,S,-0.3,-0.75,0.98,1.9,0.12,1.25,"#E5DCD6","#C9BDB5","#B5A89F")  # laptop lid (back)
lid=P(O,S,0.65,-0.69,1.62); g+=f'<circle cx="{lid[0]:.1f}" cy="{lid[1]:.1f}" r="7" fill="#5C9EAD"/>'
hx,hy=P(O,S,-0.9,-1.6,2.9)
g=f'<path d="M{hx-62} {hy+150} C{hx-62} {hy+70} {hx-40} {hy+52} {hx} {hy+52} C{hx+40} {hy+52} {hx+62} {hy+70} {hx+62} {hy+150}Z" fill="#1F4452"/>'+g
g=f'<path d="M{hx-46} {hy-6} C{hx-46} {hy-52} {hx-24} {hy-70} {hx} {hy-70} C{hx+24} {hy-70} {hx+46} {hy-52} {hx+46} {hy-6} L{hx+50} {hy+64} C{hx+30} {hy+78} {hx-30} {hy+78} {hx-50} {hy+64}Z" fill="#326273"/>'+'<ellipse cx="%.1f" cy="%.1f" rx="29" ry="33" fill="#E3B99C"/>'%(hx,hy)+f'<circle cx="{hx-10}" cy="{hy-2}" r="3.2" fill="#1F4452"/><circle cx="{hx+10}" cy="{hy-2}" r="3.2" fill="#1F4452"/><path d="M{hx-10} {hy+13} Q{hx} {hy+20} {hx+10} {hy+13}" fill="none" stroke="#1F4452" stroke-width="3" stroke-linecap="round"/>'+g
I["01-persona-finance-manager"]=g
# 2 bank with slow clock
g=shadow()
g+=box(O,S,-2.2,-1.6,0,4.4,3.2,0.4,*STONE)
for i,xx in enumerate([-1.8,-0.75,0.3,1.35]): g+=box(O,S,xx,0.9,0.4,0.42,0.42,2.6,*WHITE)
g+=box(O,S,-2.2,-1.6,3.0,4.4,3.2,0.35,*INK)
a=P(O,S,-2.2,1.6,3.35); b=P(O,S,2.2,1.6,3.35); c=P(O,S,0,1.6,4.6); d=P(O,S,0,-1.6,4.6); e=P(O,S,2.2,-1.6,3.35)
g+=poly([a,b,c],"#326273")+poly([b,e,d,c],"#24505F")
g+=badge(305,150,46,AMBER,'clock')
I["02-bank-slow-wire"]=g
# 3 proof wall
g=shadow(130)
rows=[(0,[(-2.4,1.5),(-0.8,1.5),(0.8,1.5)]),(0.75,[(-2.4,0.7),(-1.6,1.5),(0,1.5),(1.6,0.7)]),(1.5,[(-2.4,1.5),(-0.8,1.5),(0.8,1.5)]),(2.25,[(-2.4,0.7),(-1.6,1.5),(0,1.5),(1.6,0.7)])]
for z,bricks in rows:
    for x,w in bricks: g+=box(O,S,x,0,z,w-0.06,1.0,0.7,"#E3D8D0","#CBBFB7","#B5A89F")
g+=badge(200,150,48,AMBER,'x')
I["03-proof-wall"]=g
# 4 email (flat envelope)
g=shadow()
g+=box(O,S,-2.0,-1.4,0.2,4.0,2.8,0.6,*STONE)
A=P(O,S,-2.0,-1.4,0.8); B=P(O,S,2.0,-1.4,0.8); M=P(O,S,0,0.35,0.8)
g+=poly([A,M,B],"#E3D8D0",'stroke="#CBBFB7" stroke-width="4" stroke-linejoin="round"')
bc=P(O,S,1.7,-1.2,1.3); g+=badge(round(bc[0]),round(bc[1]),24,"#326273",'none')
I["04-email"]=g
# 5 chat bubble (raised slab + tail)
g=shadow()
g+=box(O,S,-2.0,-1.3,0.6,4.0,2.4,0.45,*STONE)
t1=P(O,S,-1.4,1.1,0.6); t2=P(O,S,-0.6,1.1,0.6); t3=P(O,S,-1.6,1.9,0.0)
g+=poly([t1,t2,t3],"#CBBFB7")
g+=face_lines_top(-2.0,-1.3,1.05,3.2,[(0.6,0.95),(1.2,0.7),(1.8,0.45)],"#CBBFB7",9)
I["05-chat"]=g
# 6 bank portal (upright browser panel)
g=shadow(110)
g+=box(O,S,-2.0,0,0,4.0,0.4,3.4,*STONE)
g+=box(O,S,-2.0,0,3.0,4.0,0.42,0.4,*SAND)
for i,xx in enumerate([-1.7,-1.35,-1.0]): p=P(O,S,xx,0.42,3.2); g+=f'<circle cx="{p[0]:.1f}" cy="{p[1]:.1f}" r="5" fill="#FFFFFF"/>'
g+=face_lines_left(-2.0,0.42,0.6,3.0,[(1.9,0.55),(1.3,0.85),(0.7,0.4)],"#FFFFFF",9)
g+=face_lines_left(-2.0,0.43,0.6,3.0,[(0.3,0.3)],"#326273",14)
I["06-bank-portal"]=g
# 7 phone screenshot
g=shadow(90)
g+=box(O,S,-0.8,0,0,1.8,0.3,3.8,*INK)
g+=box(O,S,-0.62,0.3,0.25,1.44,0.02,3.3,"#E7EEF1","#E7EEF1","#E7EEF1")
s0=P(O,S,-0.45,0.32,2.6); g+=f'<polygon points="{s0[0]:.1f},{s0[1]:.1f} {s0[0]+33:.1f},{s0[1]+19:.1f} {s0[0]+33:.1f},{s0[1]+52:.1f} {s0[0]:.1f},{s0[1]+33:.1f}" fill="#FFFFFF"/>'
g+=face_lines_left(-0.8,0.32,0.6,1.1,[(1.6,0.9),(1.2,0.6),(0.8,0.75)],"#C9BDB5",7)
I["07-phone-screenshot"]=g
# 8 receipt verified
g=shadow(100)
g+=box(O,S,-1.3,0,0,2.6,0.16,4.0,*WHITE)
top=[P(O,S,-1.3+0.26*i,0.16,4.0+(0.18 if i%2 else 0)) for i in range(11)]
g+=f'<polyline points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in top)}" fill="none" stroke="#E5DCD6" stroke-width="4"/>'
g+=face_lines_left(-1.3,0.17,0.6,2.0,[(2.9,0.9),(2.4,0.6),(1.9,0.75)],"#E5DCD6",9)
g+=face_lines_left(-1.3,0.17,0.6,2.0,[(1.2,0.45)],"#326273",11)
g+=badge(282,212,44,"#5C9EAD",'tick')
I["08-receipt-verified"]=g
# 9 vault + shield
g=shadow()
g+=box(O,S,-1.8,-1.8,0,3.6,3.6,3.4,*TEAL)
c=P(O,S,0,1.8,1.7)
g+=f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="40" ry="46" transform="rotate(-30 {c[0]:.1f} {c[1]:.1f}) skewX(0)" fill="#1F4452"/>'
g+=f'<ellipse cx="{c[0]:.1f}" cy="{c[1]:.1f}" rx="26" ry="30" transform="rotate(-30 {c[0]:.1f} {c[1]:.1f})" fill="#4C8293"/><circle cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="8" fill="#E5DCD6"/>'
g+=f'<path d="M300 165 l42 16 v32 c0 30-18 50-42 60 c-24-10-42-30-42-60 v-32z" fill="#5C9EAD" stroke="#fff" stroke-width="6"/><path d="M282 214 L296 228 L320 200" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>'
I["09-vault-shield"]=g
json.dump(I,open('isoicons.json','w'))
