import test from 'node:test'
import assert from 'node:assert/strict'
import { createSubmission, mapChoice } from './submissions.mjs'
const details = { firstName:'Test',lastName:'Client',email:'TEST@example.com',phone:'123456789',dialCode:'+63',language:'English',state:'Metro Manila',channel:'Phone',source:'Referral',pipeline:'123',stage:'New',host:'456',agent:'456',team:'sellers',notes:'' }
const metadata = async () => ({contacts:[],pipelines:[{id:'123',name:'New Leads',subPipelines:['Sales'],stages:['New'],fields:[{field_label:'Channel',api_name:'Channel'},{field_label:'Source',api_name:'Source'},{api_name:'Description'}]}]})
const success = id => ({data:[{status:'success',details:{id}}]})
test('existing exact email creates only a linked deal and preserves contact',async()=>{
 const calls=[]
 const request=async(path,method,body)=>{calls.push({path,method,body});return path.startsWith('Contacts/search')?{data:[{id:'existing',Email:'test@example.com'}]}:success('deal')}
 const result=await createSubmission(details,{},request,metadata)
 assert.equal(result.contactReused,true)
 assert.equal(calls.length,2)
 assert.equal(calls[1].path,'Pipelines')
 assert.equal(calls[1].body.data[0].Contact_Name.id,'existing')
 assert.equal(calls[1].body.data[0].Pipeline.id,'123')
 assert.equal(calls[1].body.data[0].Sub_Pipeline,'Sales')
 assert.equal('Closing_Date' in calls[1].body.data[0],false)
})
test('new contact is created before linked deal',async()=>{
 const calls=[]
 const request=async(path,method,body)=>{calls.push({path,method,body});return path.startsWith('Contacts/search')?{data:[]}:success(path==='Contacts'?'new-contact':'deal')}
 const result=await createSubmission(details,{},request,metadata)
 assert.equal(result.contactReused,false)
 assert.equal(calls[1].body.data[0].Email,'test@example.com')
 assert.equal(calls[2].body.data[0].Contact_Name.id,'new-contact')
})
test('ambiguous contacts stop before creating a deal',async()=>{
 await assert.rejects(createSubmission(details,{},async()=>({data:[{id:'1',Email:'test@example.com'},{id:'2',Email:'test@example.com'}]}),metadata),/Multiple contacts/)
})
test('saved contact is reused after a failed deal attempt',async()=>{
 const progress={contactId:'existing',contactReused:true}
 const calls=[]
 await createSubmission(details,progress,async(path)=>{calls.push(path);return success('deal')},metadata)
 assert.deepEqual(calls,['Pipelines'])
})
test('invalid pipeline stops all record writes',async()=>{
 let calls=0
 await assert.rejects(createSubmission({...details,pipeline:'unknown'},{},async()=>{calls++;return {}},metadata),/valid pipeline/)
 assert.equal(calls,0)
})
test('email duplicate race links existing contact',async()=>{
 const request=async(path)=>path.startsWith('Contacts/search')?{data:[]}:path==='Contacts'?{data:[{code:'DUPLICATE_DATA',details:{api_name:'Email',id:'existing'}}]}:success('deal')
 const result=await createSubmission(details,{},request,metadata)
 assert.equal(result.contactId,'existing');assert.equal(result.contactReused,true)
})

test('renamed Channel labels map to Bigin actual values',()=>{
 const field={api_name:'Channel',pick_list_values:[{display_value:'Call',actual_value:'Doxy'},{display_value:'Message',actual_value:'WhatsApp'}]}
 assert.equal(mapChoice(field,'Call'),'Doxy')
 assert.equal(mapChoice(field,'Message'),'WhatsApp')
 assert.throws(()=>mapChoice(field,'Facebook'),/available Bigin option/)
})
test('TikTok maps to actual Tiktok without changing visible form spelling',()=>{
 assert.equal(mapChoice({api_name:'Source',pick_list_values:[{display_value:'Tiktok',actual_value:'Tiktok'}]},'TikTok'),'Tiktok')
})

import { getFormMetadata } from './submissions.mjs'
test('stage options follow each pipeline dependency map rather than global stages',async()=>{
 const layout=(name,id,stage)=>({name,id,sections:[{fields:[{api_name:'Sub_Pipeline',pick_list_values:[{actual_value:name,maps:[{api_name:'Stage',pick_list_values:[{actual_value:stage}]}]}]},{api_name:'Stage',pick_list_values:[{actual_value:'Unused Global Stage'},{actual_value:stage}]}]}]})
 const m=await getFormMetadata(async path=>path.includes('fields')?{fields:[]}:{layouts:[layout('New Leads','1','New Leads'),layout('Customer Service','2','Support')]})
 assert.deepEqual(m.pipelines[0].stages,['New Leads'])
 assert.deepEqual(m.pipelines[1].stages,['Support'])
})

test('required closing date fails before searching or writing records',async()=>{
 let calls=0
 const required=async()=>{const m=await metadata();m.pipelines[0].fields.push({api_name:'Closing_Date',required:true});return m}
 await assert.rejects(createSubmission(details,{},async()=>{calls++;return {}},required),/Closing Date is still required/)
 assert.equal(calls,0)
})
test('renamed sub-pipeline sends its current record name',async()=>{
 const loader=async()=>{const m=await metadata();m.pipelines[0].fields.push({api_name:'Sub_Pipeline',pick_list_values:[{actual_value:'Sales Pipeline Standard 1',display_value:'New Leads'}]});return m}
 let payload
 await createSubmission(details,{contactId:'existing'},async(path,method,body)=>{payload=body.data[0];return success('deal')},loader)
 assert.equal(payload.Sub_Pipeline,'New Leads')
 assert.deepEqual(payload.Pipeline,{id:'123',name:'New Leads'})
})

test('booking agent name maps to the Agent Lead Management dropdown value', async () => {
 const loader = async () => {
  const result = await metadata()
  result.pipelines[0].fields.push({field_label:'Agent Lead Management',api_name:'Agent_Lead_Management',data_type:'picklist',pick_list_values:[{display_value:'Laura Garcia',actual_value:'Laura Garcia CRM'}]})
  return result
 }
 let payload
 await createSubmission(details,{contactId:'existing'},async(path,method,body)=>{payload=body.data[0];return success('deal')},loader,undefined,'Laura Garcia')
 assert.equal(payload.Agent_Lead_Management,'Laura Garcia CRM')
 assert.deepEqual(payload.Owner,{id:details.host})
 let calls = 0
 await assert.rejects(createSubmission(details,{},async()=>{calls++;return {}},loader,undefined,'Missing Agent'),/Add "Missing Agent" to the Agent Lead Management dropdown/)
 assert.equal(calls,0)
})

test('Agent Lead Management user lookups continue using the selected agent ID', async () => {
 const loader = async () => {
  const result = await metadata()
  result.pipelines[0].fields.push({field_label:'Agent Lead Management',api_name:'Agent_Lead_Management',data_type:'userlookup'})
  return result
 }
 let payload
 await createSubmission(details,{contactId:'existing'},async(path,method,body)=>{payload=body.data[0];return success('deal')},loader)
 assert.deepEqual(payload.Agent_Lead_Management,{id:details.agent})
})
