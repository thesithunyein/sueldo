const KEY = 'sueldo-lang'
const saved = localStorage.getItem(KEY)
let lang = saved === 'es' || saved === 'en' ? saved : (navigator.language || '').toLowerCase().startsWith('es') ? 'es' : 'en'

function apply() {
  document.documentElement.lang = lang
  document.querySelectorAll('[data-en]').forEach((el) => {
    const text = lang === 'es' ? el.dataset.es : el.dataset.en
    if (text == null) return
    if (el.hasAttribute('data-html')) el.innerHTML = text
    else if (el.hasAttribute('data-aria')) el.setAttribute('aria-label', text)
    else el.textContent = text
  })
  document.querySelectorAll('[data-set-lang]').forEach((btn) => {
    const on = btn.dataset.setLang === lang
    btn.classList.toggle('on', on)
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
  })
}

function setLang(next) {
  lang = next === 'es' ? 'es' : 'en'
  localStorage.setItem(KEY, lang)
  apply()
  window.dispatchEvent(new CustomEvent('sueldo-lang'))
}

window.sueldoLang = () => lang
window.setSueldoLang = setLang

document.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-set-lang]')
  if (!btn) return
  event.preventDefault()
  if (btn.dataset.setLang !== lang) setLang(btn.dataset.setLang)
})

apply()
