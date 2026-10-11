import json, importlib.util
spec=importlib.util.spec_from_file_location('iso3','iso3.py'); I=importlib.util.module_from_spec(spec); spec.loader.exec_module(I)
P,box,poly,pts=I.P,I.box,I.poly,I.pts

def kl(o,s):
    g=I.island(o,s,4.2,4.2)
    g+=box(o,s,0.35,0.35,0.34,3.5,3.5,0.05,*I.MIST,ao=False,edge=False)                # plaza
    # path
    g+=box(o,s,0.35,1.95,0.39,3.5,0.3,0.015,"#E3D8D0","#E3D8D0","#E3D8D0",ao=False,sheen=False,edge=False)
    # back buildings (small x+y first)
    g+=box(o,s,0.6,0.6,0.39,1.3,1.0,2.2,*I.WHITE); g+=I.floors(o,s,0.6,0.6,0.39,1.3,1.0,2.2,5,"#1F4452",.55,0.06)
    g+=box(o,s,0.7,0.7,2.59,1.1,0.8,0.08,*I.MIST,ao=False,edge=False)
    g+=I.tree(o,s,2.6,0.7,0.39,0.36,'canopy2')
    # tower podium + tower
    g+=box(o,s,1.3,1.3,0.39,2.0,2.0,0.5,*I.STONE)
    g+=box(o,s,1.6,1.6,0.89,1.4,1.4,5.6,*I.WHITE)
    g+=I.floors(o,s,1.6,1.6,0.89,1.4,1.4,5.6,11,"#1F4452",.85,0.07)
    g+=I.mullions(o,s,1.6,1.6,0.89,1.4,1.4,5.6,3,"#1F4452",.25)
    g+=box(o,s,1.85,1.85,6.49,0.9,0.9,0.42,*I.WHITE)
    g+=box(o,s,2.05,2.05,6.91,0.5,0.5,0.14,*I.DEEP,ao=False)
    g+=box(o,s,2.25,2.25,7.05,0.1,0.1,0.9,*I.INK,ao=False,sheen=False,edge=False)
    # front low block + trees
    g+=box(o,s,0.6,2.5,0.39,1.2,1.3,1.3,*I.SAND); g+=I.floors(o,s,0.6,2.5,0.39,1.2,1.3,1.3,3,"#1F4452",.5,0.06)
    g+=box(o,s,0.75,2.65,1.69,0.9,1.0,0.06,*I.TINT,ao=False,edge=False)
    g+=I.tree(o,s,3.5,2.6,0.39,0.4); g+=I.tree(o,s,3.1,3.4,0.39,0.32,'canopy2'); g+=I.tree(o,s,2.3,3.6,0.39,0.36)
    spire=P(o,s,2.3,2.3,7.95)
    return g,spire

def port(o,s):
    g=I.island(o,s,4.4,4.0)
    g+=box(o,s,0.3,0.3,0.34,3.8,3.4,0.05,*I.STONE,ao=False,edge=False)
    # water on the +y edge
    g+=box(o,s,0,3.1,0.1,4.4,0.9,0.22,*I.WATER,ao=False)
    for i,xx in enumerate([0.5,1.7,2.9]):
        a=P(o,s,xx,3.35+0.12*(i%2),0.33); b=P(o,s,xx+0.6,3.35+0.12*(i%2),0.33)
        g+=f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="#FFFFFF" stroke-width="2" opacity=".7" stroke-linecap="round"/>'
    # warehouse (back)
    g+=box(o,s,0.5,0.4,0.39,2.3,1.7,1.15,"#F6F1ED","#E5DCD6","#CFC4BC")
    g+=box(o,s,0.5,0.4,1.54,2.3,1.7,0.1,*I.INK,ao=False)
    g+=box(o,s,1.0,0.4,1.64,1.3,0.9,0.22,*I.MIST,ao=False,edge=False)                  # roof unit
    door=[P(o,s,2.8,0.9,0.39),P(o,s,2.8,1.6,0.39),P(o,s,2.8,1.6,1.2),P(o,s,2.8,0.9,1.2)]; g+=poly(door,"#326273")
    # container stacks
    g+=box(o,s,3.2,0.5,0.39,1.0,0.45,0.45,*I.TEAL); g+=box(o,s,3.2,0.5,0.84,1.0,0.45,0.45,*I.SAND)
    g+=box(o,s,3.2,1.05,0.39,1.0,0.45,0.45,*I.SAND); g+=box(o,s,3.2,1.05,0.84,1.0,0.45,0.45,*I.TEAL)
    g+=box(o,s,0.6,2.35,0.39,1.0,0.45,0.45,*I.TEAL)
    # bollards
    for xx in (1.0,2.2,3.4): g+=box(o,s,xx,2.95,0.39,0.14,0.14,0.18,*I.INK,ao=False,sheen=False,edge=False)
    # gantry crane straddling the quay
    for xx in (2.0,3.5): g+=box(o,s,xx,2.25,0.39,0.18,0.18,2.6,*I.INK,ao=False)
    g+=box(o,s,1.0,2.25,2.99,3.2,0.18,0.16,*I.INK,ao=False)                               # beam, cantilever over water
    g+=box(o,s,1.25,2.2,3.15,0.4,0.28,0.2,*I.DEEP,ao=False)                               # trolley
    g+=box(o,s,1.42,2.3,1.75,0.04,0.04,1.4,*I.INK,ao=False,sheen=False,edge=False)        # cable
    g+=box(o,s,1.0,2.1,1.3,0.9,0.42,0.45,*I.TEAL)                                        # hanging container
    beam=P(o,s,2.6,2.34,3.15)
    return g,beam

def bez(p0,p1,p2,p3,t):
    a=[(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3]
    return tuple(sum(k*p[i] for k,p in zip(a,[p0,p1,p2,p3])) for i in (0,1))

def build(KL=(1120,790),SK=36,PT=(1748,822),SP=31):
    g1,spire=kl(KL,SK); g2,beam=port(PT,SP)
    c1=(spire[0]+40,110); c2=(beam[0]+60,150)
    d=f"M{spire[0]:.0f} {spire[1]:.0f} C {c1[0]:.0f} {c1[1]:.0f}, {c2[0]:.0f} {c2[1]:.0f}, {beam[0]:.0f} {beam[1]:.0f}"
    route=f'<path d="{d}" fill="none" stroke="#5C9EAD" stroke-width="14" opacity=".22" filter="url(#blur6)"/>'
    route+=f'<path d="{d}" fill="none" stroke="#5C9EAD" stroke-width="4" stroke-linecap="round"/>'
    route+=f'<circle cx="{spire[0]:.0f}" cy="{spire[1]:.0f}" r="7" fill="#1F4452"/><circle cx="{beam[0]:.0f}" cy="{beam[1]:.0f}" r="7" fill="#1F4452"/>'
    # packets only where the route is visible (outside the notification card, phone and chip rects)
    rects=[(985,300,1485,520),(1290,112,1690,948),(1585,440,1865,570)]
    vis=[t/400 for t in range(401) if not any(x0<=bez(spire,c1,c2,beam,t/400)[0]<=x1 and y0<=bez(spire,c1,c2,beam,t/400)[1]<=y1 for x0,y0,x1,y1 in rects)]
    vis=[t for t in vis if 0.03<t<0.97]
    picks=[vis[int(i*(len(vis)-1)/3)] for i in range(4)] if len(vis)>4 else vis
    packets=''
    for t in picks:
        x,y=bez(spire,c1,c2,beam,t)
        packets+=f'<circle cx="{x:.0f}" cy="{y:.0f}" r="16" fill="#5C9EAD" opacity=".35" filter="url(#blur3)"/>'
        packets+=box((x,y+9),13,-0.5,-0.5,0,1,1,1,"#9CC3CD","#5C9EAD","#3F7D8E",ao=False,sheen=True,edge=True)
    svg=f'<svg class="scene" width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">{I.DEFS}{g1}{g2}{route}{packets}</svg>'
    return svg, spire, beam

if __name__=='__main__':
    svg,spire,beam=build()
    json.dump({"svg":svg,"spire":spire,"beam":beam},open('scene3.json','w'))
    print(spire,beam)
