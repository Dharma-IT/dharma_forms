// Temporary test assignment across all teams. Add your Bigin Booking Page embed URL
// below to enable the calendar. This changes form options, not CRM roles.
const testHost = { id: '7692472000000645001', name: 'Jeuz Vinci Bas', bookingUrl: 'https://us.bigin.online/org945767910/bookings/it' }

export const bookingConfig = {
  agents: [{ id: testHost.id, name: testHost.name }],
  sellers: [testHost],
  nutritionists: [testHost],
  customerService: [testHost],
  // Form choices only; map these to verified Bigin pipeline IDs before submission.
  pipelines: [
    { id: 'new-leads', name: 'New Leads' },
    { id: 'customer-service', name: 'Customer Service' },
  ],
  languages: ['English', 'Spanish', 'Filipino'],
  states: [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
    'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
    'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana',
    'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
    'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
    'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
    'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
    'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington',
    'West Virginia', 'Wisconsin', 'Wyoming',
  ],
  channels: ['Call', 'Message'],
  sources: ['Facebook', 'TikTok', 'Organic'],
}
