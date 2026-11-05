export type Lang = 'en' | 'es'

export const asLang = (value: unknown): Lang => (value === 'es' ? 'es' : 'en')

export const say = (lang: Lang, en: string, es: string): string => (lang === 'es' ? es : en)
