import type en from './locales/en'

export type Dict = { [K in keyof typeof en]: string }
export type TranslationKey = keyof Dict
