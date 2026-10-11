import math, json
C30=math.cos(math.radians(30)); S30=0.5
def P(o,s,x,y,z): return (o[0]+(x-y)*C30*s, o[1]+(x+y)*S30*s - z*s)
def poly(pts,fill,extra=''): return f'<polygon points="{" ".join(f"{a:.1f},{b:.1f}" for a,b in pts)}" fill="{fill}" {extra}/>'
def box(o,s,x,y,z,w,d,h,top,left,right,stroke=None):
    v=lambda a,b,c:P(o,s,a,b,c)
    T=[v(x,y,z+h),v(x+w,y,z+h),v(x+w,y+d,z+h),v(x,y+d,z+h)]
    R=[v(x+w,y,z),v(x+w,y+d,z),v(x+w,y+d,z+h),v(x+w,y,z+h)]   # +x face (right, darkest)
    L=[v(x,y+d,z),v(x+w,y+d,z),v(x+w,y+d,z+h),v(x,y+d,z+h)]   # +y face (left, mid)
    ex=f'stroke="{stroke}" stroke-width="1" stroke-linejoin="round"' if stroke else ''
    return poly(L,left,ex)+poly(R,right,ex)+poly(T,top,ex)
def bands_x(o,s,x,y,z,w,d,h,n,color,op=.85):  # window bands on +x and +y faces
    out=''
    for i in range(n):
        z0=z+h*(i+0.55)/(n+0.4); z1=z0+h*0.42/(n+0.4)
        out+=poly([P(o,s,x+w,y+d*0.12,z0),P(o,s,x+w,y+d*0.88,z0),P(o,s,x+w,y+d*0.88,z1),P(o,s,x+w,y+d*0.12,z1)],color,f'opacity="{op}"')
        out+=poly([P(o,s,x+w*0.12,y+d,z0),P(o,s,x+w*0.88,y+d,z0),P(o,s,x+w*0.88,y+d,z1),P(o,s,x+w*0.12,y+d,z1)],color,f'opacity="{op*0.8}"')
    return out
STONE=("#F1E9E3","#E3D8D0","#CBBFB7"); WHITE=("#FFFFFF","#EEE8E4","#D9CFC8")
TEAL=("#4C8293","#326273","#244E5C"); SAND=("#E4DAD3","#CDC1B9","#B5A89F"); INK=("#3A5C69","#1F4452","#163542")
def kl_island(o,s):
    g=box(o,s,0,0,0,3.4,3.4,0.32,*STONE)
    g+=box(o,s,0.3,0.3,0.32,3.4-0.6,3.4-0.6,0.06,"#E7EEF1","#D6E2E6","#BFD0D6")      # mist plaza
    g+=box(o,s,0.9,0.9,0.38,1.6,1.6,4.6,*WHITE)
    g+=bands_x(o,s,0.9,0.9,0.38,1.6,1.6,4.6,6,"#1F4452")
    g+=box(o,s,1.15,1.15,4.98,1.1,1.1,0.35,*WHITE)
    g+=box(o,s,1.35,1.35,5.33,0.7,0.7,0.12,"#9CC3CD","#7FAEBA","#5C9EAD")             # roof garden in teal tints
    g+=box(o,s,2.7,0.4,0.38,0.38,0.38,0.5,"#9CC3CD","#7FAEBA","#5C9EAD")              # planter
    return g
def port_island(o,s):
    g=box(o,s,0,0,0,3.6,3.4,0.32,*STONE)
    g+=box(o,s,0,2.75,0.0,3.6,0.65,0.22,"#BFD3D9","#A9C3CB","#8FB0BA")                 # water edge
    g+=box(o,s,0.25,0.25,0.32,2.0,1.5,1.05,"#F6F1ED","#E5DCD6","#CFC4BC")             # warehouse
    g+=box(o,s,0.25,0.25,1.37,2.0,1.5,0.08,*INK)                                      # roof trim
    g+=box(o,s,2.45,0.35,0.32,0.95,0.42,0.42,*TEAL)
    g+=box(o,s,2.45,0.85,0.32,0.95,0.42,0.42,*SAND)
    g+=box(o,s,2.45,0.35,0.74,0.95,0.42,0.42,*SAND)
    g+=box(o,s,0.5,1.95,0.32,0.95,0.42,0.42,*TEAL)
    # crane
    g+=box(o,s,3.05,2.15,0.32,0.14,0.14,2.3,*INK)
    g+=box(o,s,1.6,2.15,2.62,1.75,0.14,0.12,*INK)
    g+=box(o,s,1.75,2.15,2.1,0.04,0.04,0.52,*INK)
    return g
open('iso_parts.json','w').write(json.dumps({"kl":kl_island((0,0),46),"port":port_island((0,0),46)}))
