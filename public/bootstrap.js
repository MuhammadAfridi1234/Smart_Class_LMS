// Live Server only serves files. Use the Node server for authentication,
// downloads and cookies instead of depending on an extension's proxy settings.
if (location.protocol === 'file:' ||
    (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && /^55\d\d$/.test(location.port))) {
  location.replace('http://localhost:3000/' + location.search + location.hash);
}
