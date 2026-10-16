import type { Theme } from '@blocknote/mantine'

/** Notion's block colors: text color and soft background, for light and dark. */
const HIGHLIGHTS_LIGHT = {
  gray: { text: 'rgb(120, 119, 116)', background: 'rgb(241, 241, 239)' },
  brown: { text: 'rgb(159, 107, 83)', background: 'rgb(244, 238, 238)' },
  red: { text: 'rgb(212, 76, 71)', background: 'rgb(253, 235, 236)' },
  orange: { text: 'rgb(217, 115, 13)', background: 'rgb(251, 236, 221)' },
  yellow: { text: 'rgb(203, 145, 47)', background: 'rgb(251, 243, 219)' },
  green: { text: 'rgb(68, 131, 97)', background: 'rgb(237, 243, 236)' },
  blue: { text: 'rgb(51, 126, 169)', background: 'rgb(231, 243, 248)' },
  purple: { text: 'rgb(144, 101, 176)', background: 'rgb(244, 240, 247)' },
  pink: { text: 'rgb(193, 76, 138)', background: 'rgb(249, 238, 243)' },
}

const HIGHLIGHTS_DARK = {
  gray: { text: 'rgb(151, 154, 155)', background: 'rgb(47, 47, 47)' },
  brown: { text: 'rgb(147, 114, 100)', background: 'rgb(74, 50, 40)' },
  red: { text: 'rgb(255, 115, 105)', background: 'rgb(82, 46, 42)' },
  orange: { text: 'rgb(255, 163, 68)', background: 'rgb(92, 59, 35)' },
  yellow: { text: 'rgb(255, 220, 73)', background: 'rgb(86, 67, 40)' },
  green: { text: 'rgb(77, 171, 154)', background: 'rgb(36, 61, 48)' },
  blue: { text: 'rgb(82, 156, 202)', background: 'rgb(20, 58, 78)' },
  purple: { text: 'rgb(154, 109, 215)', background: 'rgb(60, 45, 73)' },
  pink: { text: 'rgb(226, 85, 161)', background: 'rgb(78, 44, 60)' },
}

const FONT_FAMILY =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"'

export const notionLightTheme: Theme = {
  colors: {
    editor: { text: 'rgb(55, 53, 47)', background: '#ffffff' },
    menu: { text: 'rgb(55, 53, 47)', background: '#ffffff' },
    tooltip: { text: '#ffffff', background: 'rgb(15, 15, 15)' },
    hovered: { text: 'rgb(55, 53, 47)', background: 'rgba(55, 53, 47, 0.08)' },
    selected: { text: 'rgb(55, 53, 47)', background: 'rgba(55, 53, 47, 0.08)' },
    disabled: { text: 'rgba(55, 53, 47, 0.4)', background: 'rgba(55, 53, 47, 0.06)' },
    shadow: 'rgba(15, 15, 15, 0.1)',
    border: 'rgba(55, 53, 47, 0.09)',
    sideMenu: 'rgba(55, 53, 47, 0.35)',
    highlights: HIGHLIGHTS_LIGHT,
  },
  borderRadius: 6,
  fontFamily: FONT_FAMILY,
}

export const notionDarkTheme: Theme = {
  colors: {
    editor: { text: 'rgba(255, 255, 255, 0.81)', background: '#191919' },
    menu: { text: 'rgba(255, 255, 255, 0.81)', background: '#252525' },
    tooltip: { text: '#ffffff', background: 'rgb(55, 55, 55)' },
    hovered: { text: 'rgba(255, 255, 255, 0.81)', background: 'rgba(255, 255, 255, 0.08)' },
    selected: { text: 'rgba(255, 255, 255, 0.81)', background: 'rgba(255, 255, 255, 0.08)' },
    disabled: { text: 'rgba(255, 255, 255, 0.28)', background: 'rgba(255, 255, 255, 0.055)' },
    shadow: 'rgba(15, 15, 15, 0.4)',
    border: 'rgba(255, 255, 255, 0.094)',
    sideMenu: 'rgba(255, 255, 255, 0.35)',
    highlights: HIGHLIGHTS_DARK,
  },
  borderRadius: 6,
  fontFamily: FONT_FAMILY,
}

export const notionTheme = { light: notionLightTheme, dark: notionDarkTheme }
