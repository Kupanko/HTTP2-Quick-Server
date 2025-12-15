# Usage
```
try {
    const server = new Server({
        host: HOST,
        port: PORT,
        key_path: 'your_path/key.pem',
        cert_path: 'your_path/cert.pem'
    });
    /* Static */
    server.hostStatic({ path: "your_path/static", cache: 21600, gzip: true });
    /* Pages */
    server.hostFile({ path: "your_path/login.html", uri: "/login" });
    server.hostFile({ path: "your_path/home.html", uri: "/home", safe: true });
    /* Dir */
    server.hostDir({ path: "your_path/icons", uri: "/assets/icons",safe: true, gzip: true, cache: 604800 });
    server.hostDir({ path: "your_path/fonts", uri: "/src/fonts/{0}", safe: true, gzip: true, cache: 21600 });
    /* Post */
    server.post({ uri: "/api/auth", fn: () => { /* your fn */ } });
    server.post({ uri: "/api/user/bookshelf", safe: true, fn: () => { /* your fn */ } });
    /* Start Server */
    server.start();
} catch (err) {
    console.error(err);
}
```
