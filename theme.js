document.addEventListener('DOMContentLoaded', () => {
  const theme = localStorage.getItem('theme');
  if (theme) document.body.className = theme;
});