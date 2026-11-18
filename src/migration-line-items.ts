export type HubSpotLineItem = { id: string; name?: string; price?: string | null; quantity?: string | null; amount?: string | null; hs_sku?: string | null; hs_line_item_currency_code?: string | null }
export function moneyCents(value: string): bigint | null {
  const match=value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if(!match)return null
  const fraction=(match[3]??'').padEnd(3,'0')
  const cents=BigInt(match[2])*100n+BigInt(fraction.slice(0,2))+(Number(fraction[2])>=5?1n:0n)
  return match[1]?-cents:cents
}
export function moneyText(cents: bigint) { const sign=cents<0n?'-':''; const absolute=cents<0n?-cents:cents; return `${sign}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}` }
export function lineItemData(item: HubSpotLineItem) {
  const issues:string[]=[]
  const price=String(item.price??'').trim(),quantity=String(item.quantity??'').trim(),value=String(item.amount??'').trim()
  const total=moneyCents(value)
  const gross=Number(price)*Number(quantity)
  if(!item.name?.trim())issues.push('Missing product name')
  if(!price||!Number.isFinite(Number(price))||Number(price)<0)issues.push('Invalid list price')
  if(!quantity||!Number.isFinite(Number(quantity))||Number(quantity)<=0)issues.push('Invalid quantity')
  if(total===null||total<0n)issues.push('Missing or invalid line-item total')
  if(item.hs_line_item_currency_code!=='USD')issues.push('Non-USD or unspecified product currency')
  let discount=''
  if(!issues.length){
    if(gross===0 && total===0n)discount='0'
    else if(gross>0){const percent=(1-Number(total)/100/gross)*100;if(percent < -0.001 || percent>100.001)issues.push('Line-item total cannot be reproduced with list price, quantity and discount');else discount=String(Math.max(0,Math.min(100,percent)).toFixed(8)).replace(/\.?0+$/,'')||'0'}
    else issues.push('Invalid product gross total')
  }
  return {name:item.name?.trim()??'',price,quantity,value:total===null?value:moneyText(total),discount,total,issues}
}
