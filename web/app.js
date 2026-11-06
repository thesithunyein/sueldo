const $ = (s) => document.querySelector(s)
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/"/g, '\u0026quot;')
    .replace(/'/g, '\u0026#39;')
const t = (en, es) => (window.sueldoLang() === 'es' ? es : en)
const loc = () => (window.sueldoLang() === 'es' ? 'es-AR' : 'en-US')
const ars = (c) => new Intl.NumberFormat(loc(), { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((Number(c) || 0) / 100)
const pesos = (c) => ((Number(c) || 0) / 100).toFixed(2)
const horas = (h) => `${new Intl.NumberFormat(loc(), { maximumFractionDigits: 1 }).format(Number(h) || 0)} h`
const dia = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(loc(), { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '')
const todayART = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
const statusLabel = (action) =>
  ({
    pay: t('Ready', 'Listo'),
    hold: t('Needs OK', 'Tu OK'),
    refuse: t('Not paid', 'No se paga'),
    skip: t('No hours', 'Sin horas'),
  })[action] || action
const apiHeaders = (extra = {}) => ({ 'x-lang': window.sueldoLang(), ...extra })

let state = null
let busy = false
let sending = false
let report = null
const approved = new Set()
let lastFocus = null
let dialogMode = ''
let dialogCtx = {}

function toast(msg, bad) {
  const el = $('#toast')
  el.textContent = msg
  el.className = `toast show${bad ? ' bad' : ''}`
  clearTimeout(toast.t)
  toast.t = setTimeout(() => { el.className = 'toast' }, 4600)
}

const bookKey = 'sueldo-book'

function rememberBook(book) {
  if (!book?.business?.name) return
  try { localStorage.setItem(bookKey, JSON.stringify(book)) } catch { /* the shop still lives for this visit */ }
}

async function load() {
  const res = await fetch('/api/state', { headers: apiHeaders() })
  if (!res.ok) throw new Error(t('Could not load the week.', 'No pude leer la semana.'))
  state = await res.json()
  if (!state.business?.name) {
    let saved = null
    try { saved = localStorage.getItem(bookKey) } catch { saved = null }
    if (saved) {
      const put = await fetch('/api/restore', {
        method: 'POST',
        headers: apiHeaders({ 'content-type': 'application/json' }),
        body: saved,
      })
      if (put.ok && (await put.json()).restored) {
        const again = await fetch('/api/state', { headers: apiHeaders() })
        if (again.ok) state = await again.json()
      }
    }
  }
  rememberBook(state.book)
  if (approved.size && state.business?.name) {
    const planRes = await fetch('/api/plan', {
      method: 'POST',
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ approvedWorkerIds: [...approved] }),
    })
    if (planRes.ok) state.plan = await planRes.json()
  }
  render()
}

function showLoadError(message) {
  $('#main').innerHTML = `
    <section class="week">
      <div>
        <p class="kicker">${esc(t('Week', 'Semana'))}</p>
        <h1>${esc(t('Could not open it.', 'No pude abrirla.'))}</h1>
        <p class="lede">${esc(message)}</p>
        <div class="hero-actions"><button class="btn primary" type="button" data-act="retry">${esc(t('Try again', 'Reintentar'))}</button></div>
      </div>
    </section>`
}

function decision(id) {
  return state.plan.decisions.find((d) => d.workerId === id)
}

function holds() {
  return state.plan.decisions.filter((d) => d.action === 'hold')
}

function openDialog(mode, title, body, foot, ctx = {}) {
  dialogMode = mode
  dialogCtx = ctx
  lastFocus = document.activeElement
  $('#dlgTitle').textContent = title
  $('#dlgBody').innerHTML = body
  $('#dlgFoot').innerHTML = foot
  const dlg = $('#dlg')
  if (!dlg.open) dlg.showModal()
  const first = $('#dlgBody').querySelector('input, select, textarea, button')
  first?.focus()
}

function closeDialog() {
  const dlg = $('#dlg')
  if (dlg.open) dlg.close()
}

$('#dlg').addEventListener('close', () => {
  lastFocus?.focus?.()
  lastFocus = null
})
$('#dlg').addEventListener('click', (event) => {
  if (event.target === $('#dlg')) closeDialog()
})
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) closeDialog()
})

function personFields(w = {}) {
  return `
    <div class="stack">
      <label class="field"><span>${esc(t('Name', 'Nombre'))}</span><input name="name" required value="${esc(w.name || '')}" autocomplete="name" /></label>
      <label class="field"><span>${esc(t('Job', 'Trabajo'))}</span><input name="role" required value="${esc(w.role || '')}" placeholder="${esc(t('Baker', 'Panadero'))}" /></label>
      <label class="field"><span>${esc(t('Pay per hour', 'Valor por hora'))}</span><input name="hourlyRate" inputmode="decimal" required value="${w.hourlyRateCentavos ? esc(pesos(w.hourlyRateCentavos)) : ''}" placeholder="6800" /></label>
      <label class="field"><span>${esc(t('Most this month', 'Tope del mes'))}</span><input name="monthlyCap" inputmode="decimal" required value="${w.monthlyCapCentavos ? esc(pesos(w.monthlyCapCentavos)) : ''}" placeholder="400000" /></label>
      <label class="field"><span>${esc(t('Where to send pay', 'Dónde cobrar'))}</span><input name="wallet" value="${w.hasWallet ? esc(w.wallet) : ''}" spellcheck="false" autocapitalize="off" placeholder="${esc(t('Optional for now', 'Opcional por ahora'))}" /></label>
      <p class="hint">${w.paidThisMonthCentavos ? esc(t(`Already paid ${ars(w.paidThisMonthCentavos)} this month.`, `Este mes ya cobró ${ars(w.paidThisMonthCentavos)}.`)) : esc(t('Optional. Leave it empty if you pay them in cash.', 'Opcional. Dejala vacía si le pagás en efectivo.'))}</p>
    </div>`
}

function openPerson(worker) {
  openDialog(
    worker ? 'edit-person' : 'add-person',
    worker ? t('Edit person', 'Editar persona') : t('Add person', 'Agregar persona'),
    personFields(worker),
    worker
      ? `<button class="btn danger" type="button" data-act="del-person" data-id="${esc(worker.id)}">${esc(t('Remove', 'Sacar'))}</button><button class="btn primary" type="submit">${esc(t('Save', 'Guardar'))}</button>`
      : `<button class="btn primary" type="submit">${esc(t('Add', 'Agregar'))}</button>`,
    { id: worker?.id },
  )
}

function openHours(workerId) {
  if (!state.workers.length) {
    toast(t('Add a person first.', 'Primero agregá una persona.'))
    openPerson()
    return
  }
  const start = state.plan.period.start
  const end = state.plan.period.end
  const today = todayART()
  const date = today >= start && today <= end ? today : start
  const options = state.workers
    .map((w) => `<option value="${esc(w.id)}"${w.id === workerId ? ' selected' : ''}>${esc(w.name)}</option>`)
    .join('')
  openDialog(
    'hours',
    t('Log hours', 'Cargar horas'),
    `<div class="stack">
      <label class="field"><span>${esc(t('Person', 'Persona'))}</span><select name="workerId">${options}</select></label>
      <label class="field"><span>${esc(t('Date', 'Fecha'))}</span><input type="date" name="date" required min="${esc(start)}" max="${esc(end)}" value="${esc(date)}" /></label>
      <p class="hint">${esc(t(`This week only, ${dia(start)} to ${dia(end)}.`, `Solo esta semana, del ${dia(start)} al ${dia(end)}.`))}</p>
      <label class="field"><span>${esc(t('Hours', 'Horas'))}</span><input type="number" name="hours" min="0.5" max="16" step="0.5" value="4" required /></label>
      <label class="field"><span>${esc(t('Note', 'Nota'))}</span><input name="note" maxlength="140" placeholder="${esc(t('Optional', 'Opcional'))}" /></label>
    </div>`,
    `<button class="btn primary" type="submit">${esc(t('Log', 'Cargar'))}</button>`,
  )
}

function openSettings() {
  const b = state.business
  openDialog(
    'settings',
    t('Settings', 'Ajustes'),
    `<div class="stack">
      <label class="field"><span>${esc(t('Business', 'Negocio'))}</span><input name="name" required value="${esc(b.name)}" /></label>
      <label class="field"><span>${esc(t('Your name', 'Tu nombre'))}</span><input name="owner" required value="${esc(b.owner)}" autocomplete="name" /></label>
      <label class="field"><span>${esc(t('City', 'Ciudad'))}</span><input name="city" required value="${esc(b.city)}" /></label>
      <label class="field"><span>${esc(t('Most you pay this month', 'Tope del mes del negocio'))}</span><input name="monthlyCap" inputmode="decimal" required value="${esc(pesos(b.monthlyTotalCapCentavos))}" /></label>
      <label class="field"><span>${esc(t('Ask me above', 'Pedime OK desde'))}</span><input name="approvalThreshold" inputmode="decimal" required value="${esc(pesos(b.approvalThresholdCentavos))}" /></label>
      <p class="hint">${esc(t('A bigger payment waits for you.', 'Un pago más grande espera tu OK.'))}</p>
      <label class="field"><span>${esc(t('Most hours in a week', 'Máximo de horas por semana'))}</span><input name="maxHoursPerWeek" type="number" min="1" max="80" step="1" required value="${esc(b.maxHoursPerWeek)}" /></label>
      <p class="hint">${esc(t('One business on this page.', 'Un solo negocio en esta página.'))}</p>
    </div>`,
    `<button class="btn primary" type="submit">${esc(t('Save', 'Guardar'))}</button>`,
  )
}

function openFund() {
  const address = state.treasury.address
  const need = state.plan.totals.computedCentavos
  const have = state.treasury.arsCentavos || 0
  const body = address
    ? `<p class="stat">${esc(ars(have))}</p>
       <p class="hint">${esc(t(`You have this now. This week needs ${ars(need)}.`, `Tenés esto ahora. Esta semana necesita ${ars(need)}.`))}</p>
       <p class="addr" id="acct">${esc(address)}</p>
       <p class="hint">${esc(t('Send pesos here. The balance updates by itself. Then you can pay.', 'Mandá los pesos acá. El saldo se actualiza solo. Después podés pagar.'))}</p>`
    : `<p class="hint">${esc(t('No business account yet. You can still plan the week. Pay turns on when the account is set up.', 'Todavía no hay cuenta del negocio. La semana se puede armar igual. El pago se activa cuando la cuenta esté lista.'))}</p>`
  openDialog(
    'fund',
    t('Add money', 'Cargar plata'),
    body,
    address ? `<button class="btn" type="button" data-act="copy">${esc(t('Copy account', 'Copiar cuenta'))}</button>` : `<button class="btn" type="button" data-close>${esc(t('Close', 'Cerrar'))}</button>`,
  )
}

function openReceipt(runId, workerId) {
  const r = state.receipts.find((x) => x.runId === runId && x.workerId === workerId)
  if (!r) return
  const worker = state.workers.find((w) => w.id === workerId)
  const tx = typeof r.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(r.txHash) ? r.txHash : ''
  const ramp = typeof r.offRampUrl === 'string' && r.offRampUrl.startsWith('https://ramp.ripio.com/') ? r.offRampUrl : ''
  const code = r.attribution?.codes?.filter(Boolean).join(', ')
  const status = r.paidHow === 'cash' && r.status === 'confirmed'
    ? t('Paid in cash', 'Pagado en efectivo')
    : ({ confirmed: t('Paid', 'Pagado'), failed: t('Did not go out', 'No salió'), pending: t('Pending', 'Pendiente'), sent: t('Sent', 'Enviado') }[r.status] || r.status)
  openDialog(
    'receipt',
    t('Receipt', 'Comprobante'),
    `<dl class="facts">
      <div><dt>${esc(t('Person', 'Persona'))}</dt><dd>${esc(r.workerName)}</dd></div>
      <div><dt>${esc(t('Period', 'Período'))}</dt><dd>${esc(r.period)}</dd></div>
      <div><dt>${esc(t('Hours', 'Horas'))}</dt><dd>${esc(horas(r.hours))}</dd></div>
      ${worker ? `<div><dt>${esc(t('Pay per hour', 'Valor por hora'))}</dt><dd>${esc(ars(worker.hourlyRateCentavos))}</dd></div>` : ''}
      <div><dt>${esc(t('Amount', 'Importe'))}</dt><dd>${esc(ars(r.amountCentavos))}</dd></div>
      <div><dt>${esc(t('Status', 'Estado'))}</dt><dd>${esc(status)}</dd></div>
      ${code ? `<div><dt>${esc(t('Code', 'Código'))}</dt><dd>${esc(code)}</dd></div>` : ''}
    </dl>
    <div class="row-actions" style="margin-top:14px">
      ${tx ? `<a href="https://celoscan.io/tx/${esc(tx)}" target="_blank" rel="noopener">${esc(t('See the payment', 'Ver el pago'))}</a>` : ''}
      ${ramp ? `<a href="${esc(ramp)}" target="_blank" rel="noopener">${esc(t('Cash out', 'Cobrar'))}</a>` : ''}
    </div>
    ${r.status === 'failed' ? `<p class="hint">${esc(t('This payment did not go out. Nothing was taken. You can try again.', 'Este pago no salió. No se descontó nada. Podés intentarlo de nuevo.'))}</p>` : ''}`,
    `<button class="btn" type="button" data-close>${esc(t('Close', 'Cerrar'))}</button>`,
  )
}

function openDelete(worker) {
  openDialog(
    'delete-person',
    t('Remove from the team', 'Sacar del equipo'),
    `<p class="hint">${esc(t(`Remove ${worker.name}? This week's hours are deleted. Past payments stay.`, `¿Sacar a ${worker.name}? Se borran las horas de esta semana. Los pagos ya hechos quedan.`))}</p>`,
    `<button class="btn quiet" type="button" data-close>${esc(t('Cancel', 'Cancelar'))}</button><button class="btn danger" type="submit">${esc(t('Remove', 'Sacar'))}</button>`,
    { id: worker.id },
  )
}

async function send(url, options = {}) {
  const res = await fetch(url, { ...options, headers: apiHeaders(options.headers || {}) })
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || t('Could not finish that.', 'No se pudo completar.'))
  return data
}

$('#dlgForm').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (sending) return
  if (dialogMode === 'confirm-pay') {
    closeDialog()
    runPay()
    return
  }
  sending = true
  const submitBtn = event.currentTarget.querySelector('[type="submit"]')
  if (submitBtn) submitBtn.disabled = true
  const data = new FormData(event.currentTarget)
  const body = Object.fromEntries(data.entries())
  try {
    if (dialogMode === 'add-person' || dialogMode === 'edit-person') {
      await send(dialogMode === 'add-person' ? '/api/workers' : `/api/workers/${dialogCtx.id}`, {
        method: dialogMode === 'add-person' ? 'POST' : 'PATCH',
        headers: apiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      })
      toast(dialogMode === 'add-person' ? t('Person added.', 'Persona agregada.') : t('Saved.', 'Datos guardados.'))
    } else if (dialogMode === 'hours') {
      await send('/api/shifts', {
        method: 'POST',
        headers: apiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ ...body, hours: Number(String(body.hours).replace(',', '.')) }),
      })
      toast(t('Hours logged.', 'Horas cargadas.'))
    } else if (dialogMode === 'settings') {
      await send('/api/business', {
        method: 'POST',
        headers: apiHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(body),
      })
      toast(t('Settings saved.', 'Ajustes guardados.'))
    } else if (dialogMode === 'delete-person') {
      await send(`/api/workers/${dialogCtx.id}`, { method: 'DELETE' })
      approved.delete(dialogCtx.id)
      toast(t('Removed from the team.', 'Persona sacada del equipo.'))
    } else {
      return
    }
    closeDialog()
    await load()
  } catch (error) {
    toast(error.message, true)
    if (submitBtn) submitBtn.disabled = false
  } finally {
    sending = false
  }
})

function summary() {
  const { plan, treasury, agent } = state
  const held = holds()
  const refused = plan.decisions.filter((d) => d.action === 'refuse')
  if (!plan.totals.computedCentavos) return t('No hours this week.', 'No hay horas esta semana.')
  if (!agent.configured && plan.totals.payCentavos > 0) {
    const n = plan.totals.headcount
    return n === 1
      ? t('1 person can be paid. You hand them the pesos.', '1 persona puede cobrar. Le das los pesos.')
      : t(`${n} people can be paid. You hand them the pesos.`, `${n} personas pueden cobrar. Les das los pesos.`)
  }
  const funds = agent.configured && refused.length && refused.every((d) => d.reasons.some((r) => r.code === 'G_FONDOS'))
  if (funds) return t(`You have ${ars(treasury.arsCentavos || 0)}. This week needs ${ars(plan.totals.computedCentavos)}.`, `Hay ${ars(treasury.arsCentavos || 0)}. Esta semana necesita ${ars(plan.totals.computedCentavos)}.`)
  const parts = []
  if (plan.totals.headcount) parts.push(plan.totals.headcount === 1 ? t('1 person can be paid', '1 persona puede cobrar') : t(`${plan.totals.headcount} people can be paid`, `${plan.totals.headcount} personas pueden cobrar`))
  if (held.length) parts.push(held.length === 1 ? t('1 needs your OK', '1 necesita tu OK') : t(`${held.length} need your OK`, `${held.length} necesitan tu OK`))
  if (refused.length) parts.push(refused.length === 1 ? t('1 cannot be paid', '1 no se puede pagar') : t(`${refused.length} cannot be paid`, `${refused.length} no se pueden pagar`))
  return parts.length ? `${parts.join('. ')}.` : t('Nothing to pay this week.', 'Nada para pagar esta semana.')
}

function progressList() {
  const run = state.run
  if (!run) return `<p class="hint">${esc(t('Preparing the payment.', 'Preparando el pago.'))}</p>`
  const rows = run.decisions.filter((d) => d.action === 'pay')
  let marked = false
  return `<ol class="progress">${rows
    .map((d) => {
      let label = { confirmed: t('Paid', 'Pagado'), failed: t('Did not go out', 'No salió'), sent: t('Sent', 'Enviado'), pending: t('Waiting', 'En espera') }[d.status] || t('Waiting', 'En espera')
      if (d.status === 'pending' && run.running && !marked) {
        label = t('In progress', 'En curso')
        marked = true
      }
      return `<li><span>${esc(d.workerName)}</span><span class="num">${esc(ars(d.grossCentavos))} · ${esc(label)}</span></li>`
    })
    .join('')}</ol>`
}

function renderChrome() {
  const on = Boolean(state?.business?.name)
  $('#fundBtn').hidden = !on || !state.agent?.configured
  $('#settingsBtn').hidden = !on
  const biz = $('#bizLabel')
  biz.hidden = !on
  if (on) biz.innerHTML = `<b>${esc(state.business.name)}</b><span>${esc(state.business.city)}</span>`
}

function render() {
  renderChrome()
  const main = $('#main')
  if (!state.business?.name) {
    main.innerHTML = `
      <section class="week">
        <div>
          <p class="kicker">${esc(t('Start', 'Empezar'))}</p>
          <h1>${esc(t('Create the business', 'Crear el negocio'))}</h1>
          <p class="lede">${esc(t('Three details. Then add one person and their hours.', 'Tres datos. Después, una persona y las horas.'))}</p>
        </div>
      </section>
      <form class="card stack" id="onboard">
        <label class="field"><span>${esc(t('Business name', 'Nombre del negocio'))}</span><input name="name" required autocomplete="organization" /></label>
        <label class="field"><span>${esc(t('Your name', 'Tu nombre'))}</span><input name="owner" required autocomplete="name" /></label>
        <label class="field"><span>${esc(t('City', 'Ciudad'))}</span><input name="city" required autocomplete="address-level2" /></label>
        <div><button class="btn primary" type="submit">${esc(t('Create business', 'Crear negocio'))}</button></div>
      </form>`
    return
  }

  const { plan, workers, shifts, receipts, month, treasury, business, agent } = state
  const payable = plan.decisions.filter((d) => d.action === 'pay').reduce((s, d) => s + d.grossCentavos, 0)
  const held = holds()
  const heldSum = held.reduce((s, d) => s + d.grossCentavos, 0)
  const fundsBlock = payable === 0 && plan.totals.computedCentavos > 0 && plan.decisions.some((d) => d.reasons.some((r) => r.code === 'G_FONDOS'))
  const showGuide = workers.length === 0 || shifts.length === 0
  const monthHref = /^\d{4}-\d{2}$/.test(month.key) ? `/api/export.csv?month=${month.key}&lang=${window.sueldoLang()}` : `/api/export.csv?lang=${window.sueldoLang()}`
  const cash = !agent.configured
  const payLabel = busy
    ? t('Saving…', 'Guardando…')
    : payable > 0
      ? `${cash ? t('Mark paid', 'Marcar pagado') : t('Pay', 'Pagar')} ${esc(ars(payable))}`
      : fundsBlock
        ? t('Not enough money', 'No alcanza')
        : t('Nothing to pay', 'Nada para pagar')
  const payHint = cash
    ? t('This writes the week in the book. You still hand over the cash.', 'Esto anota la semana. La plata la das vos.')
    : fundsBlock
      ? t('Add money. Friday will not pay until the account covers this week.', 'Cargá plata. El viernes tampoco se paga si no alcanza.')
      : agent.schedule
        ? t('Friday at 6 pm pays what is ready.', 'El viernes a las 18 se paga lo que está listo.')
        : t('You start the payment.', 'El pago sale cuando lo ejecutás.')

  const people = plan.decisions.map((d) => {
    const w = workers.find((x) => x.id === d.workerId)
    const shown = d.reasons.filter((r) => {
      if (!agent.configured && r.code === 'G_FONDOS') return false
      return !(r.code === 'G_FONDOS' && d.reasons.every((x) => x.code === 'G_FONDOS'))
    })
    const reasons = shown.length
      ? `<ul class="reasons">${shown.map((r) => `<li>${esc(r.message)}${r.detail ? ` ${esc(r.detail)}` : ''}</li>`).join('')}</ul>`
      : ''
    return `
      <div class="person">
        <div class="who">
          <div class="name">${esc(d.workerName)}</div>
          <div class="subline">${esc(w?.role || '')} · ${esc(ars(w?.hourlyRateCentavos || 0))}/${esc(t('hour', 'hora'))}${w?.hasWallet ? '' : ` · ${esc(t('no pay account', 'sin cuenta'))}`}</div>
        </div>
        <div class="money">
          <div class="amt">${esc(ars(d.grossCentavos))}</div>
          <div class="subline">${esc(horas(d.hours))} · <span class="chip ${esc(d.action)}">${esc(statusLabel(d.action))}</span></div>
        </div>
        ${reasons}
        <div class="row-actions">
          <button class="btn small quiet" type="button" data-act="hours" data-id="${esc(d.workerId)}">${esc(t('Hours', 'Horas'))}</button>
          <button class="btn small quiet" type="button" data-act="edit" data-id="${esc(d.workerId)}">${esc(t('Edit', 'Editar'))}</button>
          ${d.action === 'hold' ? `<button class="btn small" type="button" data-act="approve" data-id="${esc(d.workerId)}">${esc(t('Approve', 'Aprobar'))}</button>` : ''}
        </div>
      </div>`
  }).join('')

  const shiftRows = shifts.map((s) => {
    const name = workers.find((w) => w.id === s.workerId)?.name || t('Person', 'Persona')
    return `
      <div class="shift">
        <span class="num">${esc(dia(s.date))}</span>
        <span>${esc(name)} · ${esc(horas(s.hours))}</span>
        <span class="note muted">${esc(s.note || '')}</span>
        <button class="icon" type="button" data-act="del-shift" data-id="${esc(s.id)}" aria-label="${esc(t(`Delete the ${dia(s.date)} shift for ${name}`, `Borrar el turno del ${dia(s.date)} de ${name}`))}">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l1 12h6l1-12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>`
  }).join('')

  const receiptRows = receipts.map((r) => {
    const label = r.paidHow === 'cash' && r.status === 'confirmed'
      ? t('Paid in cash', 'Pagado en efectivo')
      : ({ confirmed: t('Paid', 'Pagado'), failed: t('Did not go out', 'No salió'), pending: t('Pending', 'Pendiente'), sent: t('Sent', 'Enviado') }[r.status] || '')
    return `
    <button class="receipt" type="button" data-act="receipt" data-run="${esc(r.runId)}" data-worker="${esc(r.workerId)}">
      <span><span class="name">${esc(r.workerName)}</span><span class="subline"> · ${esc(r.period)}${label ? ` · ${esc(label)}` : ''}</span></span>
      <span class="money num">${esc(ars(r.amountCentavos))}</span>
    </button>`
  }).join('')

  const fails = report?.decisions?.filter((d) => d.action === 'pay' && d.status === 'failed') || []
  const oks = report?.decisions?.filter((d) => d.action === 'pay' && d.status === 'confirmed') || []

  const nextAct = workers.length === 0 ? 'add' : shifts.length === 0 ? 'hours' : ''
  const nextLabel = workers.length === 0
    ? t('Add a person', 'Agregar persona')
    : shifts.length === 0
      ? t('Log hours', 'Cargar horas')
      : payLabel
  const payDisabled = busy || (nextAct === '' && payable === 0)

  main.innerHTML = `
    ${showGuide ? `<ol class="guide">
      <li class="${workers.length ? 'done' : 'now'}">
        <button type="button" data-act="add">
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.5 19.2c1.3-3 3.6-4.4 6.5-4.4s5.2 1.4 6.5 4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          <span>1. ${esc(t('Add a person', 'Agregá una persona'))}</span>
        </button>
      </li>
      <li class="${shifts.length ? 'done' : workers.length ? 'now' : ''}">
        <button type="button" data-act="hours" ${workers.length ? '' : 'disabled'}>
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 8.2V12l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>2. ${esc(t('Log the hours', 'Cargá las horas'))}</span>
        </button>
      </li>
      <li class="${payable > 0 ? 'now' : ''}">
        <button type="button" id="guidePay" ${payable > 0 && !busy ? '' : 'disabled'}>
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8.4 12.2l2.3 2.3 4.9-5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>3. ${esc(t('Mark the week paid', 'Marcá la semana pagada'))}</span>
        </button>
      </li>
    </ol>` : ''}
    <section class="week">
      <div>
        <p class="kicker">${esc(t('This week', 'Esta semana'))} · ${esc(plan.period.label)}</p>
        <h1>${esc(ars(plan.totals.computedCentavos))}</h1>
        <p class="lede" aria-live="polite">${esc(summary())}</p>
      </div>
      <div class="week-actions">
        <button class="btn primary" type="button" id="${nextAct ? '' : 'payBtn'}" data-act="${nextAct}" ${payDisabled ? 'disabled' : ''}>${nextLabel}</button>
        <p class="hint">${esc(payHint)}</p>
      </div>
    </section>
    ${held.length ? `<section class="approval">
      <div>
        <h2>${held.length === 1 ? esc(t('1 payment needs your OK', '1 pago necesita tu OK')) : esc(t(`${held.length} payments need your OK`, `${held.length} pagos necesitan tu OK`))} · ${esc(ars(heldSum))}</h2>
        <p>${esc(t('Approve them and they become ready. What you skip does not get paid.', 'Si los aprobás, quedan listos. Lo que no apruebes no se paga.'))}</p>
      </div>
      <button class="btn" type="button" data-act="approve-all">${esc(held.length === 1 ? t('Approve', 'Aprobar') : t('Approve all', 'Aprobar todos'))}</button>
    </section>` : ''}
    ${(busy || state.run?.running) ? `<article class="card"><div class="card-h"><h2>${esc(t('Payment in progress', 'Pago en curso'))}</h2></div>${progressList()}</article>` : ''}
    ${report && !busy ? `<article class="card">
      <div class="card-h"><h2>${fails.length ? esc(t(`${oks.length} paid. ${fails.length} failed.`, `Se pagaron ${oks.length}. Fallaron ${fails.length}.`)) : esc(t(`${oks.length} paid.`, `Se pagaron ${oks.length}.`))}</h2>
      <button class="btn small quiet" type="button" data-act="dismiss">OK</button></div>
      ${fails.length ? `<ul class="report">${fails.map((d) => `<li><span>${esc(d.workerName)} · ${esc(ars(d.grossCentavos))}</span><span>${esc(t('Did not go out. Nothing was taken.', 'No salió. No se descontó nada.'))}</span></li>`).join('')}</ul><p class="hint">${esc(t('You can try again. A person already paid is not paid twice.', 'Podés intentarlo de nuevo. Si ya cobró, no se paga dos veces.'))}</p>` : ''}
    </article>` : ''}
    <div class="layout">
      <article class="card">
        <div class="card-h"><h2>${esc(t('Team', 'Equipo'))}</h2><button class="btn small" type="button" data-act="add">${esc(t('Add', 'Agregar'))}</button></div>
        ${people || `<div class="empty"><p class="name">${esc(t('Your team starts here.', 'Tu equipo empieza acá.'))}</p><p class="hint">${esc(t('Name, job, and pay per hour. The pay account can wait.', 'Nombre, trabajo y valor por hora. La cuenta puede esperar.'))}</p><button class="btn" type="button" data-act="add">${esc(t('Add person', 'Agregar persona'))}</button></div>`}
      </article>
      <div>
        <article class="card">
          <div class="card-h"><h2>${esc(agent.configured ? t('Money', 'Plata') : t('To hand over', 'Para entregar'))}</h2>${agent.configured ? `<button class="btn small quiet" type="button" data-act="fund">${esc(t('Add money', 'Cargar plata'))}</button>` : ''}</div>
          <p class="stat">${esc(ars(agent.configured ? (treasury.arsCentavos || 0) : payable))}</p>
          <p class="hint">${esc(agent.configured ? (treasury.address ? t('Ready to send.', 'Listo para enviar.') : t('No business account yet.', 'Todavía no hay cuenta del negocio.')) : t('Cash for the people who are ready.', 'Efectivo para las personas que están listas.'))}</p>
        </article>
        <article class="card">
          <div class="card-h"><h2>${esc(t('This month', 'Este mes'))}</h2></div>
          <p class="stat">${esc(ars(month.paidCentavos))}</p>
          <p class="hint">${esc(t(`of ${ars(month.capCentavos)} allowed`, `de ${ars(month.capCentavos)} permitidos`))}</p>
          <dl class="facts">
            <div><dt>${esc(t('Ask you above', 'Tu OK desde'))}</dt><dd>${esc(ars(business.approvalThresholdCentavos))}</dd></div>
            <div><dt>${esc(t('Hour limit', 'Tope de horas'))}</dt><dd>${esc(business.maxHoursPerWeek)} h</dd></div>
          </dl>
          <div class="row-actions" style="margin-top:14px">
            <a class="btn small" href="${monthHref}">${esc(t('Download month', 'Bajar el mes'))}</a>
          </div>
          <p class="hint">${esc(t('Name, hours, amount, date.', 'Nombre, horas, importe, fecha.'))}</p>
        </article>
      </div>
    </div>
    <article class="card">
      <div class="card-h"><h2>${esc(t('Hours', 'Horas'))}</h2><button class="btn small" type="button" data-act="hours">${esc(t('Log', 'Cargar'))}</button></div>
      ${shiftRows || `<div class="empty"><p class="name">${esc(t('No hours yet.', 'Todavía no hay horas.'))}</p><p class="hint">${esc(t('Log one shift to see the total.', 'Cargá un turno para ver el total.'))}</p><button class="btn" type="button" data-act="hours">${esc(t('Log hours', 'Cargar horas'))}</button></div>`}
    </article>
    <article class="card">
      <div class="card-h"><h2>${esc(t('Receipts', 'Comprobantes'))}</h2></div>
      ${receiptRows || `<div class="empty"><p class="name">${esc(t('No receipts yet.', 'Todavía no hay comprobantes.'))}</p><p class="hint">${esc(t('They show up when you mark the week paid.', 'Aparecen cuando marcás la semana como pagada.'))}</p></div>`}
    </article>
    <footer class="foot">
      <span>${esc(agent.configured ? (agent.schedule ? t('Friday at 6 pm pays what is ready.', 'El viernes a las 18 se paga lo que está listo.') : t('You start the payment.', 'El pago sale cuando lo ejecutás.')) : t('You mark the week paid after you hand over the cash.', 'Marcás la semana pagada después de entregar la plata.'))}</span>
      <span>${esc(t('One business on this page.', 'Un solo negocio en esta página.'))}</span>
    </footer>`
}

document.addEventListener('submit', async (event) => {
  const form = event.target
  if (form.id !== 'onboard') return
  event.preventDefault()
  const body = Object.fromEntries(new FormData(form).entries())
  try {
    await send('/api/business', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    await load()
    toast(t('Business created.', 'Negocio creado.'))
    openPerson()
  } catch (error) {
    toast(error.message, true)
  }
})

document.addEventListener('click', async (event) => {
  const el = event.target.closest('[data-act]')
  if (!el) return
  const act = el.dataset.act
  if (act === 'retry') {
    load().catch((error) => showLoadError(error.message))
    return
  }
  if (!state) return
  const id = el.dataset.id
  if (act === 'add') return openPerson()
  if (act === 'edit') {
    const worker = state.workers.find((w) => w.id === id)
    if (!worker) return toast(t('That person is no longer here.', 'Esa persona ya no está.'), true)
    return openPerson(worker)
  }
  if (act === 'hours') return openHours(id)
  if (act === 'fund') return openFund()
  if (act === 'del-person') {
    const worker = state.workers.find((w) => w.id === id)
    if (!worker) return
    return openDelete(worker)
  }
  if (act === 'receipt') return openReceipt(el.dataset.run, el.dataset.worker)
  if (act === 'dismiss') {
    report = null
    render()
    return
  }
  if (act === 'copy') {
    const text = $('#acct')?.textContent || ''
    try {
      await navigator.clipboard.writeText(text)
      toast(t('Account copied.', 'Cuenta copiada.'))
    } catch {
      toast(t('Could not copy. Select the account and copy it by hand.', 'No pude copiar. Seleccioná la cuenta y copiala a mano.'), true)
    }
    return
  }
  if (act === 'approve') {
    approved.add(id)
    await load()
    toast(t('Ready. Pay now, or leave it for Friday.', 'Quedó listo. Pagalo ahora o dejalo para el viernes.'))
    return
  }
  if (act === 'approve-all') {
    holds().forEach((d) => approved.add(d.workerId))
    await load()
    toast(t('Ready. Pay now, or leave them for Friday.', 'Quedaron listos. Pagalos ahora o dejalos para el viernes.'))
    return
  }
  if (act === 'del-shift') {
    try {
      await send(`/api/shifts/${id}`, { method: 'DELETE' })
      toast(t('Shift deleted.', 'Turno borrado.'))
      await load()
    } catch (error) {
      toast(error.message, true)
    }
  }
})

function openPayConfirm() {
  const rows = state.plan.decisions.filter((d) => d.action === 'pay')
  const total = rows.reduce((s, d) => s + d.grossCentavos, 0)
  const cash = !state.agent?.configured
  openDialog(
    'confirm-pay',
    cash ? t('Mark as paid', 'Marcar como pagado') : t('Pay now', 'Pagar ahora'),
    `<p class="hint">${esc(cash ? t('This writes the week as paid in cash. It does not send money. You still hand them the pesos.', 'Esto anota la semana como pagada en efectivo. No envía plata. Los pesos los das vos.') : t('This cannot be undone. Someone already paid this week is not paid again.', 'Esto no se puede deshacer. Si alguien ya cobró esta semana, no se le paga de nuevo.'))}</p>
     <ul class="progress">${rows.map((d) => `<li><span>${esc(d.workerName)}</span><span class="num">${esc(ars(d.grossCentavos))}</span></li>`).join('')}</ul>
     <p class="stat">${esc(ars(total))}</p>`,
    `<button class="btn quiet" type="button" data-close>${esc(t('Back', 'Volver'))}</button><button class="btn primary" type="submit">${esc(cash ? t('Mark paid', 'Marcar pagado') : t('Pay now', 'Pagar ahora'))}</button>`,
  )
}

async function runPay() {
  if (busy) return
  busy = true
  report = null
  render()
  const poll = setInterval(() => load().catch(() => {}), 1200)
  try {
    const data = await send('/api/run', {
      method: 'POST',
      headers: apiHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ approvedWorkerIds: [...approved] }),
    })
    report = data
    approved.clear()
    const pays = (data.decisions || []).filter((d) => d.action === 'pay')
    const ok = pays.filter((d) => d.status === 'confirmed')
    const bad = pays.filter((d) => d.status === 'failed')
    const sum = ok.reduce((s, d) => s + d.grossCentavos, 0)
    toast(bad.length ? t(`${ok.length} paid. ${bad.length} failed.`, `Se pagaron ${ok.length}. Fallaron ${bad.length}.`) : t(`${ok.length} paid. ${ars(sum)}`, `Se pagaron ${ok.length}. ${ars(sum)}`), bad.length > 0)
  } catch (error) {
    toast(error.message, true)
  } finally {
    clearInterval(poll)
    busy = false
    await load()
  }
}

document.addEventListener('click', async (event) => {
  const pay = event.target.closest('#payBtn, #guidePay')
  if (!pay || busy || pay.disabled) return
  openPayConfirm()
})

$('#fundBtn').addEventListener('click', () => state && openFund())
$('#settingsBtn').addEventListener('click', () => state && openSettings())

load().catch((error) => showLoadError(error.message))
window.addEventListener('sueldo-lang', () => {
  closeDialog()
  load().catch((error) => showLoadError(error.message))
})
setInterval(() => {
  if (busy) return
  if ($('#dlg')?.open) return
  if (!state?.business?.name) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  load().catch(() => {})
}, 20000)
