// Applies the saved theme before first paint to avoid a light-mode flash.
// Kept as a file (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  if ((localStorage.getItem('appTheme') || 'light') === 'dark') {
    document.documentElement.classList.add('dark')
  }
} catch (e) {
  /* storage blocked — default theme */
}
