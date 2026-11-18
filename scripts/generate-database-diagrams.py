"""Generate editable native draw.io diagrams from PostgreSQL catalog metadata.
No records or secrets are read. Render/export with draw.io's native editor protocol.
"""
from pathlib import Path
import json,re,math,xml.etree.ElementTree as E
from html import escape
BASE=Path(__file__).resolve().parents[1]
OUT=BASE/'docs'/'diagrams'
meta=json.loads((BASE/'docs/schema-metadata.json').read_text(encoding='utf-8-sig'))
tables={}
for c in meta['columns']: tables.setdefault(c['table_name'],[]).append(c)
cons=meta['constraints']; pk={}; fks=[]; unique={}
for c in cons:
 t=c['table_name']; d=c['definition']
 if c['contype']=='p':pk[t]=re.search(r'PRIMARY KEY \((.*?)\)',d).group(1).split(', ')
 if c['contype']=='u':unique.setdefault(t,[]).append(re.search(r'UNIQUE \((.*?)\)',d).group(1))
 if c['contype']=='f':
  m=re.search(r'FOREIGN KEY \((.*?)\) REFERENCES (\w+)\((.*?)\)',d)
  fks.append(dict(child=t,cols=m[1].split(', '),parent=m[2],refs=m[3].split(', '),name=c['conname'],definition=d))
for i,f in enumerate(fks,1):f['tag']=f'F{i:02}'
labels={'deliveries':'Delivery','app_users':'User','resource_requests':'Resource Request','request_items':'Request Item','allocation_items':'Allocation Item','disaster_locations':'Disaster Impact','delivery_volunteers':'Delivery Volunteer','inventory_movements':'Stock Movement','resource_categories':'Resource Category','relief_camps':'Relief Camp','audit_logs':'Audit Log','login_attempts':'Login Attempt','incident_reports':'Incident Report'}
def label(t):return labels.get(t,t.replace('_',' ').title().removesuffix('s'))
def fkcols(t):return set(c for f in fks if f['child']==t for c in f['cols'])
def datatype(c):
 d=c['data_type']; n=c['character_maximum_length']
 if d=='character varying':return f'VARCHAR({n})'
 if d=='timestamp with time zone':return 'TIMESTAMPTZ'
 if d=='numeric':return f'NUMERIC({c["numeric_precision"]},{c["numeric_scale"]})'
 return d.upper()
groups=[
 ('01 Identity & audit',['roles','app_users','sessions','audit_logs','login_attempts']),
 ('02 Disasters & facilities',['locations','disasters','disaster_locations','relief_camps','warehouses']),
 ('03 Resources & inventory',['resource_categories','resources','inventory','inventory_movements']),
 ('04 Requests & allocations',['resource_requests','request_items','allocations','allocation_items']),
 ('05 Transport & volunteers',['vehicles','deliveries','volunteers','delivery_volunteers']),
 ('06 Incident documents',['incident_reports'])]
rel_names={
 ('app_users','role_id'):'Has role',('sessions','user_id'):'Authenticates',('audit_logs','user_id'):'Performs',
 ('disasters','created_by'):'Creates',('disasters','event_location_id'):'Event site',('disaster_locations','disaster_id'):'Has impact',('disaster_locations','location_id'):'Impact at',('relief_camps','location_id'):'Hosts camp',('relief_camps','manager_id'):'Manages camp',('warehouses','location_id'):'Hosts depot',('warehouses','manager_id'):'Manages depot',
 ('resources','category_id'):'Classifies',('inventory','warehouse_id'):'Stores',('inventory','resource_id'):'Stock of',('inventory_movements','warehouse_id'):'Records change',
 ('resource_requests','camp_id'):'Needs supplies',('resource_requests','disaster_id'):'Responds to',('resource_requests','requested_by'):'Submits',('request_items','request_id'):'Contains item',('request_items','resource_id'):'Requests resource',('allocations','request_id'):'Fulfills',('allocations','allocated_by'):'Allocates',('allocation_items','allocation_id'):'Contains line',('allocation_items','request_id'):'Satisfies item',('allocation_items','warehouse_id'):'Draws stock',
 ('vehicles','current_location_id'):'Located at',('deliveries','allocation_id'):'Ships',('deliveries','vehicle_id'):'Transported by',('deliveries','driver_id'):'Driven by',('deliveries','source_location_id'):'Departs from',('deliveries','destination_location_id'):'Arrives at',('delivery_volunteers','delivery_id'):'Assigns helper',('delivery_volunteers','volunteer_id'):'Participates'}
class Page:
 def __init__(self,name,w,h,kind):
  self.name=name;self.w=w;self.h=h;self.counter=0;self.kind=kind
  self.model=E.Element('mxGraphModel',dx='1600',dy='1000',grid='1',gridSize='10',guides='1',tooltips='1',connect='1',arrows='1',fold='1',page='1',pageScale='1',pageWidth=str(w),pageHeight=str(h),math='0',shadow='0',background='#ffffff')
  self.root=E.SubElement(self.model,'root');E.SubElement(self.root,'mxCell',id='0');E.SubElement(self.root,'mxCell',id='1',parent='0')
  self.entities={};self.fields={};self.manifest={'name':name,'full':[],'contexts':[],'foreignKeys':[]}
 def nid(self):self.counter+=1;return f'n{self.counter}'
 def node(self,value,x,y,w,h,style='',id=None):
  id=id or self.nid();c=E.SubElement(self.root,'mxCell',id=id,value=value,style='html=1;whiteSpace=wrap;fontFamily=Arial;'+style,vertex='1',parent='1');E.SubElement(c,'mxGeometry',x=str(x),y=str(y),width=str(w),height=str(h),**{'as':'geometry'});return id
 def text(self,s,x,y,w,h,size=18,color='#334155',align='left',bold=False):return self.node(s,x,y,w,h,f'text;strokeColor=none;fillColor=none;fontSize={size};fontColor={color};align={align};verticalAlign=middle;'+('fontStyle=1;' if bold else ''))
 def edge(self,source,target,points=None,value='',color='#334155',arrow='none',dashed=False,exit=None,entry=None,width=1.5):
  id=self.nid();style=f'html=1;rounded=0;edgeStyle=none;endArrow={arrow};endFill=1;strokeColor={color};strokeWidth={width};fontFamily=Arial;fontSize=17;fontStyle=1;fontColor={color};labelBackgroundColor=#ffffff;jumpStyle=arc;jumpSize=10;'
  if dashed:style+='dashed=1;dashPattern=6 4;'
  if exit:style+=f'exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;'
  if entry:style+=f'entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;'
  c=E.SubElement(self.root,'mxCell',id=id,value=value,style=style,edge='1',source=source,target=target,parent='1');g=E.SubElement(c,'mxGeometry',relative='1',**{'as':'geometry'})
  if points:
   a=E.SubElement(g,'Array',**{'as':'points'})
   for x,y in points:E.SubElement(a,'mxPoint',x=str(x),y=str(y))
  return id
 def header(self,title,sub):
  self.text('RELIEFFLOW / DATABASE DESIGN',70,35,self.w-140,28,17,'#596b80',bold=True)
  self.text(title,70,83,self.w-140,65,36,'#142c42',bold=True)
  self.text(sub,70,160,self.w-140,50,19)
  self.node('',70,230,self.w-140,2,'fillColor=#cbd5e1;strokeColor=none;')
 def footer(self,s):self.text(s,70,self.h-95,self.w-140,65,17,'#526276')
 def save(self,parent):
  d=E.SubElement(parent,'diagram',id=self.name.split()[0]+'-'+self.kind,name=self.name);d.append(self.model)
 def standalone(self):
  root=E.Element('mxfile',host='app.diagrams.net',type='device',version='29.0.0');self.save(root);return E.tostring(root,encoding='unicode')

def erentity(p,t,x,y,context=False):
 p.manifest['contexts' if context else 'full'].append(t)
 style='rounded=0;fillColor='+('#f2f5f8' if context else '#e5f1df')+';strokeColor='+('#8f9eae' if context else '#648351')+';strokeWidth=2;fontColor=#1e3522;fontSize=21;fontStyle=1;'
 if context:style+='dashed=1;'
 n=p.node(escape(label(t))+f'<br/><span style="font-size:14px;font-weight:normal">{t}</span>',x-125,y-35,250,70,style)
 p.entities[t]=(n,x,y)
 columns=pk[t] if context else [c['column_name'] for c in tables[t] if c['column_name'] not in fkcols(t) or c['column_name'] in pk[t]]
 for i,a in enumerate(columns):
  side=i%2;index=i//2;count=(len(columns)+1-side)//2
  ax=x+(-350 if side==0 else 350);ay=y+(index-(count-1)/2)*85
  st='ellipse;fillColor='+('#f7f8fa' if context else '#fff0f2')+';strokeColor='+('#9aa7b3' if context else '#bd7c8b')+';strokeWidth=1.4;fontSize=17;fontColor=#3e3540;'
  attr=p.node(f'<u>{a}</u>' if a in pk[t] else a,ax-113,ay-27,226,54,st)
  p.edge(n,attr,color='#9aa4ad',width=1.1)
 if context:p.text('key reference',x-100,y+53,200,24,13,'#68798b','center')
 return n

def relationship(p,f,x,y,route='horizontal',lane=None):
 parent=f['parent'];child=f['child'];a,ax,ay=p.entities[parent];b,bx,by=p.entities[child]
 title=rel_names.get((child,f['cols'][0]),'References')
 if len(f['cols'])>1:title+='<br/><span style="font-size:13px">composite reference</span>'
 d=p.node(title,x-95,y-51,190,102,'rhombus;fillColor=#e9e6fb;strokeColor=#8177b3;strokeWidth=1.8;fontSize=17;fontColor=#373052;')
 nullable=any(c['column_name'] in f['cols'] and c['is_nullable']=='YES' for c in tables[child]);card='0..1' if nullable else '1'
 if route=='vertical':
  p.edge(a,d,[(ax,y-100),(x,y-100)],card,exit=(.5,1),entry=(.5,0));p.edge(d,b,[(x,y+110),(bx,y+110)],'0..N',exit=(.5,1),entry=(.5,0))
 elif route=='top':
  p.edge(a,d,[(ax,y),(x-150,y)],card,exit=(.5,0),entry=(0,.5));p.edge(d,b,[(bx,y)],'0..N',exit=(1,.5),entry=(.5,0))
 elif route=='bottom':
  # Both entity stems leave below their attributes; the relationship sits in the clear lower corridor.
  p.edge(a,d,[(ax,y)],card,exit=(.5,1),entry=((0 if ax<x else 1),.5));p.edge(d,b,[(bx,y)],'0..N',exit=((1 if bx>x else 0),.5),entry=(.5,1))
 else:
  p.edge(a,d,[(ax,y)],card,exit=(.5,1),entry=((0 if ax<x else 1),.5));p.edge(d,b,[(bx,y)],'0..N',exit=((1 if bx>x else 0),.5),entry=(.5,0))
 p.manifest['foreignKeys'].append(f['name'])

def make_er(i,name,full):
 p=Page(name,4300 if i in [3,4] else 3200,2800 if i in [3,4] else 2500,'er')
 p.header('Entity–Relationship Diagram • '+name[3:],'Chen notation: green entities · pink attributes · purple relationships · underlined keys · gray entities repeat a key defined on another page')
 p.text('Cardinality: 1 = required parent; 0..1 = optional parent; 0..N = any number of child records. FK-only columns are represented by relationships.',70,245,p.w-140,55,17)
 if i==0:
  pos={'roles':(500,700),'app_users':(1600,700),'sessions':(2700,700),'audit_logs':(1600,1750),'login_attempts':(500,1750)}
  routes={('app_users','role_id'):(1050,350,'top'),('sessions','user_id'):(2150,350,'top'),('audit_logs','user_id'):(1600,1200,'vertical')}
  p.text('LOGIN_ATTEMPTS is keyed by email. It intentionally has no user FK, so failed logins for unknown accounts can also be counted.',2180,1550,850,140,19)
 elif i==1:
  pos={'locations':(500,700),'disasters':(1600,700),'app_users':(2700,700),'warehouses':(500,1800),'disaster_locations':(1600,1800),'relief_camps':(2700,1800)}
  routes={('disasters','event_location_id'):(1050,350,'top'),('disasters','created_by'):(2150,350,'top'),('warehouses','location_id'):(500,1200,'vertical'),('disaster_locations','disaster_id'):(1600,1200,'vertical'),('relief_camps','manager_id'):(2700,1200,'vertical'),('disaster_locations','location_id'):(1050,1050,'horizontal'),('warehouses','manager_id'):(2150,1370,'horizontal'),('relief_camps','location_id'):(2150,1530,'horizontal')}
 elif i==2:
  pos={'resource_categories':(500,700),'resources':(1600,700),'warehouses':(2700,700),'inventory_movements':(500,1800),'inventory':(1600,1800)}
  routes={('resources','category_id'):(1050,350,'top'),('inventory','warehouse_id'):(2150,1250,'horizontal'),('inventory','resource_id'):(1600,1200,'vertical'),('inventory_movements','warehouse_id'):(1050,2220,'bottom')}
 elif i==3:
  pos={'app_users':(500,500),'relief_camps':(1600,500),'disasters':(2700,500),'resources':(3800,500),'resource_requests':(1050,1250),'request_items':(2700,1250),'allocations':(1050,2250),'allocation_items':(2700,2250),'inventory':(3800,2250)}
  routes={('resource_requests','requested_by'):(550,850,'horizontal'),('resource_requests','camp_id'):(1100,750,'horizontal'),('resource_requests','disaster_id'):(1850,950,'horizontal'),('request_items','request_id'):(1900,1100,'top'),('request_items','resource_id'):(3250,850,'horizontal'),('allocations','request_id'):(1050,1750,'vertical'),('allocations','allocated_by'):(500,1850,'horizontal'),('allocation_items','allocation_id'):(1900,2600,'bottom'),('allocation_items','request_id'):(2700,1750,'vertical'),('allocation_items','warehouse_id'):(3250,2600,'bottom')}
 elif i==4:
  pos={'vehicles':(500,700),'locations':(1600,500),'app_users':(2700,500),'allocations':(3800,500),'deliveries':(2700,1550),'volunteers':(500,2300),'delivery_volunteers':(1600,2300)}
  routes={('vehicles','current_location_id'):(1050,350,'top'),('deliveries','vehicle_id'):(1600,1060,'horizontal'),('deliveries','driver_id'):(2700,980,'vertical'),('deliveries','allocation_id'):(3250,1000,'horizontal'),('deliveries','source_location_id'):(2050,800,'horizontal'),('deliveries','destination_location_id'):(2050,1250,'horizontal'),('delivery_volunteers','delivery_id'):(2150,1980,'horizontal'),('delivery_volunteers','volunteer_id'):(1050,2630,'bottom')}
 else:return make_mongo_er(p)
 for t,(x,y) in pos.items():erentity(p,t,x,y,t not in full)
 for f in fks:
  if f['child'] in full:
   x,y,r=routes[(f['child'],f['cols'][0])];relationship(p,f,x,y,r)
 p.footer('PostgreSQL physical entities • composite keys are underlined together • attributes and relationships reflect the migrated database • ReliefFlow')
 return p

def make_mongo_er(p):
 # MongoDB is a document model, not an extra PostgreSQL relation.
 erentity(p,'app_users',500,1850,True);erentity(p,'disasters',2700,1850,True)
 n=p.node('<b>Incident Report</b><br/><span style="font-size:14px">MongoDB: incident_reports</span>',1440,865,320,80,'rounded=0;fillColor=#e5f1df;strokeColor=#648351;strokeWidth=2;fontSize=22;')
 attrs=[('_id',1250,500,True),('reportType',1600,450,False),('description',1950,500,False),('severity',2200,800,False),('tags',2200,1100,False),('createdAt',1950,1400,False),('updatedAt',1250,1400,False),('location',1000,1000,False)]
 for name,x,y,key in attrs:
  a=p.node('<u>_id</u>' if key else name,x-113,y-28,226,56,('ellipse;shape=doubleEllipse;' if name=='tags' else 'ellipse;')+'fillColor=#fff0f2;strokeColor=#bd7c8b;fontSize=19;strokeWidth=1.5;');p.edge(n,a,color='#9aa4ad',width=1.1)
  if name=='location':
   for sub,sx,sy in [('label',500,1050),('latitude',500,1200),('longitude',500,1350)]:
    q=p.node(sub,sx-105,sy-26,210,52,'ellipse;fillColor=#fff0f2;strokeColor=#bd7c8b;fontSize=18;');p.edge(a,q,color='#9aa4ad',width=1.1)
 for t,x,y,title in [('app_users',1000,1700,'Reports'),('disasters',2200,1700,'About event')]:
  d=p.node(title,x-90,y-48,180,96,'rhombus;fillColor=#e9e6fb;strokeColor=#8177b3;fontSize=19;');a,ax,ay=p.entities[t]
  p.edge(a,d,[(ax,1700)],'1',color='#39758a',dashed=True,exit=(.5,0),entry=(0 if ax<x else 1,.5))
  p.edge(d,n,[(x,1550),(1600,1550)],'0..N',color='#39758a',dashed=True,exit=(.5,0),entry=(.5,1))
 p.text('Dashed references are validated by the API: reportedBy → app_users.user_id; disasterId → disasters.disaster_id. They are NOT SQL foreign keys.',950,2080,1700,100,21,'#32687c','center')
 p.text('location is a composite attribute. tags is multi-valued (double oval). _id is an ObjectId. No cross-database transaction or FK is implied.',950,2230,1700,80,18,'#526276','center')
 p.manifest['full'].append('incident_reports');p.manifest['applicationReferences']=['reportedBy','disasterId']
 p.footer('MongoDB document extension • required fields and bounds follow db/mongodb/validator.json • no invented SQL relation')
 return p

def relation_row(p,t,x,y,context=False,refs=None):
 columns=[c for c in tables[t] if not context or c['column_name'] in (refs or pk[t])]
 p.manifest['contexts' if context else 'full'].append(t)
 total=sum(max(145,min(220,len(c['column_name'])*9+34)) for c in columns)
 p.text(t.upper()+('  [key reference]' if context else ''),x,y-85,max(total,550),35,25 if not context else 20,'#142c42',bold=True)
 fields={};cx=x
 for c in columns:
  a=c['column_name'];is_pk=a in pk[t];is_fk=a in fkcols(t);w=max(145,min(220,len(a)*9+34))
  title=escape(a)
  if is_pk:title=f'<u>{title}</u>'
  elif is_fk:title=f'<span style="border-bottom:1px dashed #334155">{title}</span>'
  keys=('PK' if is_pk else '')+(' / FK' if is_pk and is_fk else 'FK' if is_fk else '')
  tag=(keys+' · ' if keys else '')+datatype(c)+(' *' if c['is_nullable']=='NO' else '')
  cell=p.node(title+f'<br/><span style="font-size:12px;color:#64748b">{escape(tag)}</span>',cx,y,w,76,'rounded=0;strokeColor=#475569;strokeWidth=1.5;fontSize=17;fillColor='+('#f5f7fa' if context else '#eff7eb' if is_pk else '#fff8ed' if is_fk else '#ffffff')+';')
  fields[a]=(cell,cx+w/2,y,w)
  cx+=w
 p.fields[t]=fields
 if not context:
  keycols=pk[t];keyx=sum(fields[k][1] for k in keycols)/len(keycols);bus_y=y-28
  # Joint determinant: all PK columns connect to the same bus, not separate candidate keys.
  keyset=p.node('',keyx-1,bus_y-1,2,2,'ellipse;fillColor=#b6323e;strokeColor=#b6323e;')
  for k in keycols:
   cell,kx,_,_=fields[k];p.edge(cell,keyset,[(kx,bus_y)],color='#b6323e',exit=(.5,0),entry=(.5,.5),width=1.3)
  for c in columns:
   a=c['column_name']
   if a not in keycols:
    cell,fx,_,_=fields[a];p.edge(keyset,cell,[(fx,bus_y)],color='#b6323e',arrow='classic',exit=(.5,.5),entry=(.5,0),width=1.3)
  keylabel='PK '+(' + '.join(keycols))+' → all other attributes'
  uk='  |  UK: '+'; '.join(unique.get(t,[])) if unique.get(t) else ''
  p.text(escape(keylabel+uk),x,y+90,max(total,1000),30,15,'#8c2d38')
 return total

def make_rel(i,name,full):
 if i==5:return mongo_rel(name)
 contexts=sorted(set(f['parent'] for f in fks if f['child'] in full)-set(full))
 nctxrows=math.ceil(len(contexts)/3)
 start=360+nctxrows*250
 h=max(2350,start+len(full)*355+180)
 p=Page(name,3600,h,'schema')
 p.header('Relational Schema • '+name[3:],'Reference style: horizontal attribute rows · solid-underlined PK · dashed-underlined FK · red functional dependencies · black referential arrows')
 p.text('* = NOT NULL. Composite PK members act jointly. One black arrow per FK constraint; composite column tuples are listed beneath the source row.',70,245,3460,55,18)
 for j,t in enumerate(contexts):
  referenced=set(r for f in fks if f['child'] in full and f['parent']==t for r in f['refs'])
  relation_row(p,t,330+(j%3)*1050,390+(j//3)*250,True,referenced)
 for j,t in enumerate(full):relation_row(p,t,330,start+85+j*355)
 relevant=[f for f in fks if f['child'] in full]
 for j,f in enumerate(relevant):
  a,ax,ay,_=p.fields[f['child']][f['cols'][0]];b,bx,by,_=p.fields[f['parent']][f['refs'][0]]
  lane=60+j*18;source_y=ay+150+(j%3)*17;target_y=by+145+(j%3)*17
  p.edge(a,b,[(ax,source_y),(lane,source_y),(lane,target_y),(bx,target_y)],value=f['tag'],color='#26313e',arrow='classic',exit=(.5,1),entry=(.5,1),width=1.5)
  p.manifest['foreignKeys'].append(f['name'])
 for t in full:
  fs=[f for f in relevant if f['child']==t]
  if fs:
   y=next(iter(p.fields[t].values()))[2]
   txt='   |   '.join(f['tag']+': ('+', '.join(f['cols'])+') → '+f['parent']+'('+', '.join(f['refs'])+')' for f in fs)
   p.text(escape(txt),330,y+205,3150,55,15,'#26313e')
 p.footer('Exact table and column names from the PostgreSQL catalog • gray key references are expanded in their owning page • arrow tags match the FK list')
 return p

def mongo_rel(name):
 p=Page(name,3600,1900,'schema');p.header('Document Schema • Incident reports','MongoDB extension — shown separately from PostgreSQL relations; application references are dashed blue, not SQL foreign keys.')
 relation_row(p,'app_users',330,420,True,['user_id']);relation_row(p,'disasters',2000,420,True,['disaster_id'])
 attrs=[('_id','ObjectId','document key'),('disasterId','number','application reference'),('reportedBy','number','application reference'),('reportType','string','required'),('description','string','required'),('severity','string','required'),('location','object','required'),('tags','string[]','optional'),('createdAt','Date','required'),('updatedAt','Date','required')]
 p.text('INCIDENT_REPORTS  [MongoDB collection]',330,730,2800,45,27,'#142c42',bold=True)
 x=330;fields={}
 for a,typ,key in attrs:
  w=265;v=('<u>_id</u>' if a=='_id' else a)+f'<br/><span style="font-size:13px">{typ}<br/>{key}</span>'
  n=p.node(v,x,820,w,100,'rounded=0;strokeColor=#475569;fillColor='+('#eff7eb' if a=='_id' else '#f1f8fb')+';fontSize=20;');fields[a]=(n,x+w/2);x+=w
 for j,(a,t,k) in enumerate([('reportedBy','app_users','user_id'),('disasterId','disasters','disaster_id')]):
  source,sx=fields[a];target,tx,ty,_=p.fields[t][k]
  p.edge(source,target,[(sx,1030+j*80),(90+j*60,1030+j*80),(90+j*60,600+j*50),(tx,600+j*50)],'API reference',color='#39758a',arrow='classic',dashed=True,exit=(.5,1),entry=(.5,1))
 p.text('location = { label: string, latitude?: number [−90, 90], longitude?: number [−180, 180] }',330,1190,2800,70,23,'#334155')
 p.text('tags = array of up to 20 strings • _id is MongoDB-managed • no relational functional-dependency arrows are claimed for the document collection.',330,1310,2800,80,21,'#526276')
 p.text('Validation: required report identity/type/description/location/severity/timestamps; enum values and string/coordinate bounds. Existing documents are preserved with moderate validation.',330,1450,2800,110,20,'#526276')
 p.manifest['full'].append('incident_reports');p.manifest['applicationReferences']=['reportedBy','disasterId'];p.footer('MongoDB is intentionally not represented as a PostgreSQL table • reference checks happen in /api/incidents')
 return p

def write_book(filename,pages):
 root=E.Element('mxfile',host='app.diagrams.net',type='device',version='29.0.0',pages=str(len(pages)),agent='ReliefFlow schema documentation')
 for i,p in enumerate(pages):
  p.save(root)
  stem=filename.removesuffix('.drawio')+'-'+str(i+1).zfill(2)
  (OUT/'pages'/f'{stem}.drawio').write_text(p.standalone(),encoding='utf8')
 (OUT/filename).write_text(E.tostring(root,encoding='unicode'),encoding='utf8')
 return [{'file':filename,'page':i+1,'stem':filename.removesuffix('.drawio')+'-'+str(i+1).zfill(2),**p.manifest} for i,p in enumerate(pages)]

def main():
 er=[make_er(i,n,t) for i,(n,t) in enumerate(groups)]
 rel=[make_rel(i,n,t) for i,(n,t) in enumerate(groups)]
 manifests=write_book('ReliefFlow-ER-Diagram.drawio',er)+write_book('ReliefFlow-Relational-Schema.drawio',rel)
 for kind,pages in [('ER',er),('Relational',rel)]:
  actual=[x for p in pages for x in p.manifest['full'] if x!='incident_reports']
  assert sorted(actual)==sorted(tables), (kind,actual)
  ff=[x for p in pages for x in p.manifest['foreignKeys']]
  assert sorted(ff)==sorted(f['name'] for f in fks),(kind,ff)
 (OUT/'diagram-manifest.json').write_text(json.dumps({'tables':len(tables),'columns':len(meta['columns']),'foreignKeys':len(fks),'pages':manifests},indent=2),encoding='utf8')
 print(f'Created 2 editable draw.io books, 6 pages each; {len(tables)} SQL tables, {len(meta["columns"])} columns, {len(fks)} FK constraints + MongoDB extension.')
if __name__=='__main__':main()

