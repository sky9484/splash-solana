import math
C30=math.cos(math.radians(30))
def P(o,s,x,y,z): return (o[0]+(x-y)*C30*s, o[1]+(x+y)*0.5*s - z*s)
def pts(*ps): return " ".join(f"{a:.1f},{b:.1f}" for a,b in ps)
def poly(ps,fill,extra=''): return f'<polygon points="{pts(*ps)}" fill="{fill}" {extra}/>'
DEFS='''<defs>
<linearGradient id="aoL" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1F4452" stop-opacity=".16"/><stop offset=".55" stop-color="#1F4452" stop-opacity="0"/></linearGradient>
<linearGradient id="aoR" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1F4452" stop-opacity=".22"/><stop offset=".6" stop-color="#1F4452" stop-opacity="0"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".30"/><stop offset=".7" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>
<radialGradient id="canopy" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#9CC3CD"/><stop offset="1" stop-color="#5C9EAD"/></radialGradient>
<radialGradient id="canopy2" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#B9D5DC"/><stop offset="1" stop-color="#7FAEBA"/></radialGradient>
<filter id="blur18" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
<filter id="blur6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="blur3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>'''
def box(o,s,x,y,z,w,d,h,top,left,right,ao=True,sheen=True,edge=True):
    v=lambda a,b,c:P(o,s,a,b,c)
    T=[v(x,y,z+h),v(x+w,y,z+h),v(x+w,y+d,z+h),v(x,y+d,z+h)]
    R=[v(x+w,y,z),v(x+w,y+d,z),v(x+w,y+d,z+h),v(x+w,y,z+h)]
    L=[v(x,y+d,z),v(x+w,y+d,z),v(x+w,y+d,z+h),v(x,y+d,z+h)]
    out=poly(L,left)+poly(R,right)
    if ao and h*s>6: out+=poly(L,'url(#aoL)')+poly(R,'url(#aoR)')
    out+=poly(T,top)
    if sheen: out+=poly(T,'url(#sheen)')
    if edge: out+=f'<polyline points="{pts(v(x,y+d,z+h),v(x+w,y+d,z+h),v(x+w,y,z+h))}" fill="none" stroke="#FFFFFF" stroke-width="1.2" opacity=".6" stroke-linejoin="round"/>'
    return out
def floors(o,s,x,y,z,w,d,h,n,color,op=.9,thick=0.09):
    out=''
    for i in range(n):
        z0=z+h*(i+0.45)/n; z1=z0+thick
        out+=poly([P(o,s,x+w,y+d*0.1,z0),P(o,s,x+w,y+d*0.9,z0),P(o,s,x+w,y+d*0.9,z1),P(o,s,x+w,y+d*0.1,z1)],color,f'opacity="{op}"')
        out+=poly([P(o,s,x+w*0.1,y+d,z0),P(o,s,x+w*0.9,y+d,z0),P(o,s,x+w*0.9,y+d,z1),P(o,s,x+w*0.1,y+d,z1)],color,f'opacity="{op*0.75}"')
    return out
def mullions(o,s,x,y,z,w,d,h,n,color,op=.35):
    out=''
    for i in range(1,n):
        a=P(o,s,x+w,y+d*i/n,z+0.05); b=P(o,s,x+w,y+d*i/n,z+h-0.05)
        out+=f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{color}" stroke-width="1.2" opacity="{op}"/>'
        a=P(o,s,x+w*i/n,y+d,z+0.05); b=P(o,s,x+w*i/n,y+d,z+h-0.05)
        out+=f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" stroke="{color}" stroke-width="1.2" opacity="{op*0.8}"/>'
    return out
def tree(o,s,x,y,z,r=0.42,grad='canopy'):
    g=box(o,s,x-0.06,y-0.06,z,0.12,0.12,0.5,"#B5A89F","#9E9087","#8A7D74",ao=False,sheen=False,edge=False)
    c=P(o,s,x,y,z+0.5+r*0.9); rr=r*s
    g+=f'<ellipse cx="{c[0]:.1f}" cy="{c[1]+rr*0.9:.1f}" rx="{rr*0.9:.1f}" ry="{rr*0.35:.1f}" fill="#1F4452" opacity=".08"/>'
    g+=f'<circle cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="{rr:.1f}" fill="url(#{grad})"/>'
    return g
def island(o,s,w,d,top=("#F3ECE7","#E3D8D0","#CBBFB7"),earth=("#D9CEC6","#C4B6AC","#A99A90"),thick=0.34):
    g=''
    c=P(o,s,w/2,d/2,0); 
    g+=f'<ellipse cx="{c[0]:.1f}" cy="{c[1]+0.9*s:.1f}" rx="{(w+d)*0.42*s:.1f}" ry="{(w+d)*0.12*s:.1f}" fill="#1F4452" opacity=".16" filter="url(#blur18)"/>'
    g+=box(o,s,0.12,0.12,-thick*1.6,w-0.24,d-0.24,thick*1.6,*earth,sheen=False,edge=False)
    g+=box(o,s,0,0,0,w,d,thick,*top)
    return g
STONE=("#F3ECE7","#E3D8D0","#CBBFB7"); WHITE=("#FFFFFF","#EFE9E5","#DBD1CA"); SAND=("#E8DED6","#D1C5BC","#B9ACA2")
TEAL=("#5C9EAD","#3F7D8E","#2F6473"); DEEP=("#4C8293","#326273","#244E5C"); INK=("#3A5C69","#1F4452","#163542")
MIST=("#EAF0F2","#D7E3E7","#BFD1D7"); TINT=("#9CC3CD","#7FAEBA","#5C9EAD"); WATER=("#CFE0E5","#B5CBD2","#9CB8C1")
AMBER="#B4690E"
