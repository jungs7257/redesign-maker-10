import json
p='data/detail-builder.json'
d=json.load(open(p))
doc=d.get('doc',d)
secs=doc['sections']
assert len(secs)==10, len(secs)
json.dump(d, open('data/detail-builder.json.bak-r2','w'), ensure_ascii=False, indent=2)
s7=secs[6]
ship={'fee':s7.get('fee',''),'island':s7.get('island',''),'leadTime':s7.get('leadTime','')}
s6old=secs[5]
s6rows=s6old.get('rows') or []
secs[5]={'type':'howto','title':'제품의 사용법 및 활용','body':'','image':''}
secs[6]={'type':'review','title':'상품 사용에 대한 후기','items':['','','']}
s10=secs[9]
old_rows=s10.get('rows') or []
new_rows=[['제조연월/제조자',''],['제조국/수입자',''],['품질보증기준',''],['취급 시 주의사항','']]
for r in old_rows:
    if r and (r[1] or '').strip(): new_rows.append([r[0],r[1]])
for label,val in [('배송비',ship['fee']),('도서산간 추가배송비',ship['island']),('출고 기간',ship['leadTime'])]:
    if (val or '').strip(): new_rows.append([label,val])
for r in s6rows:
    if r and (r[1] or '').strip(): new_rows.append([r[0],r[1]])
secs[9]={'type':'notice','title':'상품정보 제공고시','rows':new_rows}
json.dump(d, open(p,'w'), ensure_ascii=False, indent=2)
print('OK')
for i,s in enumerate(secs): print(i+1, s.get('type'),'|',(s.get('title') or '')[:30])
