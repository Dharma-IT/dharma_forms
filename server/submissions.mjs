import { getAccessToken } from './bigin.mjs'

export async function biginRequest(path, method = 'GET', body) {
  const token = await getAccessToken()
  const response = await fetch(`${token.apiDomain}/bigin/v2/${path}`, {
    method, headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  if (response.status === 204) return { data: [] }
  const result = await response.json()
  if (!response.ok) {
    if (result.code === 'OAUTH_SCOPE_MISMATCH') throw new Error('Bigin permissions need updating. Authorize modules, secure search, fields, and layouts before submitting.')
    const row = result.data?.[0] || result
    const field = row.details?.api_name
    const error = new Error(`Bigin rejected the request (${row.code || response.status}${field ? `: ${field}` : ''}).`)
    error.definitiveRejection = response.status >= 400 && response.status < 500 && response.status !== 408
    throw error
  }
  return result
}

const allFields = layout => (layout.sections || []).flatMap(section => section.fields || [])
export async function getFormMetadata(request = biginRequest) {
  const [contacts, layouts] = await Promise.all([
    request('settings/fields?module=Contacts'), request('settings/layouts?module=Pipelines'),
  ])
  const pipelines = (layouts.layouts || []).filter(layout => ['New Leads', 'Customer Service'].includes(layout.name)).map(layout => {
    const fields = allFields(layout)
    const values = api => (fields.find(field => field.api_name === api)?.pick_list_values || []).map(v => v.actual_value).filter(v => v && v !== '-None-')
    const subPipelines = fields.find(field => field.api_name === 'Sub_Pipeline')?.pick_list_values || []
    // The Stage field includes unused/global options. Only the sub-pipeline's
    // dependency map describes which stages can actually be selected here.
    const mappedStages = subPipelines.length === 1
      ? subPipelines[0].maps?.find(map => map.api_name === 'Stage')?.pick_list_values || []
      : []
    const stageDefinitions = fields.find(field => field.api_name === 'Stage')?.pick_list_values || []
    const isClosed = value => stageDefinitions.find(stage => stage.actual_value === value)?.deal_category?.startsWith('Closed')
    const stages = mappedStages.map(stage => stage.actual_value).filter(Boolean)
    stages.sort((a, b) => Number(Boolean(isClosed(a))) - Number(Boolean(isClosed(b))))
    return { id: layout.id, name: layout.name, subPipelines: values('Sub_Pipeline'), stages, fields }
  })
  return { contacts: contacts.fields || [], pipelines }
}

function fieldByLabel(fields, label) {
  return fields.find(field => String(field.field_label || field.display_label).toLowerCase() === label.toLowerCase())
}
export function mapChoice(field, value) {
  if (!field?.pick_list_values?.length) return value
  const normalized = value.trim().toLowerCase()
  const matches = field.pick_list_values.filter(item =>
    [item.display_value, item.actual_value].some(option => typeof option === 'string' && option.trim().toLowerCase() === normalized),
  )
  if (matches.length !== 1 || matches[0].actual_value === '-None-') {
    throw new Error(`The selected ${field.field_label || field.api_name} is not an available Bigin option.`)
  }
  return matches[0].actual_value
}

function inserted(result, module) {
  const row = result.data?.[0]
  if (row?.status !== 'success' || !row.details?.id) throw new Error(`${module} could not be saved (${row?.code || 'invalid response'}). Check required fields and dropdown values.`)
  return row.details.id
}

export async function createSubmission(details, progress, request = biginRequest, metadataLoader = getFormMetadata, save = async () => {}) {
  for (const key of ['firstName', 'lastName', 'email', 'phone', 'dialCode', 'language', 'state', 'channel', 'source', 'pipeline', 'stage', 'host', 'agent', 'team']) {
    if (typeof details[key] !== 'string' || !details[key].trim() || details[key].length > 255) throw new Error(`A valid ${key} is required.`)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) throw new Error('Enter a valid email address.')
  if (!/^\d+$/.test(details.host) || !/^\d+$/.test(details.agent)) throw new Error('Select valid Bigin users.')
  if (typeof details.notes !== 'string' || details.notes.length > 2000) throw new Error('Notes must be 2000 characters or fewer.')
  const metadata = await metadataLoader(request)
  const pipeline = metadata.pipelines.find(item => item.id === details.pipeline)
  if (!pipeline || !pipeline.stages.includes(details.stage)) throw new Error('Select a valid pipeline and stage.')
  if (pipeline.subPipelines.length !== 1) throw new Error('This pipeline needs an explicit sub-pipeline mapping before saving.')
  if (pipeline.fields.some(field => field.api_name === 'Closing_Date' && (field.required || field.system_mandatory))) {
    throw new Error(`Closing Date is still required in the ${pipeline.name} Bigin layout. Make it optional in Bigin, save the layout, then retry. No new records were created by this attempt.`)
  }
  const subPipelineOption = pipeline.fields.find(field => field.api_name === 'Sub_Pipeline')?.pick_list_values?.[0]
  // Unlike ordinary custom picklists, the record API expects the current
  // sub-pipeline name; actual_value can retain the pre-rename internal name.
  const subPipeline = subPipelineOption?.display_value || pipeline.subPipelines[0]
  const channel = fieldByLabel(pipeline.fields, 'Channel') || fieldByLabel(pipeline.fields, 'Chanel')
  const source = fieldByLabel(pipeline.fields, 'Source') || fieldByLabel(pipeline.fields, 'Lead Source')
  if (!channel || !source) throw new Error('Add Channel and Source fields to the selected Bigin pipeline before saving.')
  const channelValue = mapChoice(channel, details.channel)
  const sourceValue = mapChoice(source, details.source)
  const dealAgent = fieldByLabel(pipeline.fields, 'Agent Lead Management')
  const contactLanguage = fieldByLabel(metadata.contacts, 'Preferred Language')
  const languageValue = contactLanguage ? mapChoice(contactLanguage, details.language) : details.language
  const email = details.email.trim().toLowerCase()
  if (!progress.contactId) {
    const result = await request(`Contacts/search?email=${encodeURIComponent(email)}`)
    const exact = (result.data || []).filter(item => item.Email?.trim().toLowerCase() === email)
    if (exact.length > 1) throw new Error('Multiple contacts match this email. Resolve the duplicates in Bigin first.')
    if (exact.length === 1) {
      progress.contactId = exact[0].id
      progress.contactReused = true
    } else {
      const contact = { First_Name: details.firstName.trim(), Last_Name: details.lastName.trim(), Email: email, Phone: `${details.dialCode}${details.phone}`, Mailing_State: details.state.trim() }
      if (contactLanguage) contact[contactLanguage.api_name] = languageValue
      const result = await request('Contacts', 'POST', { data: [contact] })
      const row = result.data?.[0]
      if (row?.code === 'DUPLICATE_DATA' && row.details?.api_name === 'Email' && row.details?.id) {
        progress.contactId = row.details.id; progress.contactReused = true
      } else { progress.contactId = inserted(result, 'Contact'); progress.contactReused = false }
    }
    await save(progress)
  }
  if (!progress.dealId) {
    const deal = {
      Deal_Name: `${details.firstName.trim()} ${details.lastName.trim()} - Consultation`,
      Contact_Name: { id: progress.contactId }, Owner: { id: details.host },
      Pipeline: { id: pipeline.id, name: pipeline.name }, Sub_Pipeline: subPipeline, Stage: details.stage,
      [channel.api_name]: channelValue, [source.api_name]: sourceValue,
    }
    if (dealAgent?.data_type === 'userlookup') deal[dealAgent.api_name] = { id: details.agent }
    // Retain the booking agent even when no dedicated deal field exists.
    if (pipeline.fields.some(f => f.api_name === 'Description')) deal.Description = `Booked by Bigin user: ${details.agent}\nTeam: ${details.team}\n${details.notes}`
    progress.dealAttempted = true
    await save(progress)
    let result
    try { result = await request('Pipelines', 'POST', { data: [deal] }) }
    catch (error) {
      if (error.definitiveRejection) {
        progress.dealAttempted = false
        await save(progress)
        throw error
      }
      throw new Error(`${error.message} Deal outcome is uncertain. Check Bigin before retrying.`)
    }
    if (result.data?.[0]?.status === 'error') {
      progress.dealAttempted = false
      await save(progress)
    }
    progress.dealId = inserted(result, 'Deal')
    await save(progress)
  }
  return { contactId: progress.contactId, dealId: progress.dealId, contactReused: progress.contactReused }
}
