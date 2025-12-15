"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Server = void 0;
const http2_1 = __importDefault(require("http2"));
const zlib_1 = __importDefault(require("zlib"));
const fs_1 = __importDefault(require("fs"));
const MIME_TYPES = {
    "html": "text/html",
    "gif": "image/gif",
    "css": "text/css",
    "mjs": "text/javascript",
    "js": "text/javascript",
    "json": "application/json",
    "jpg": "image/jpg",
    "png": "image/png",
    "svg": "image/svg+xml",
    "ttf": "font/ttf",
    "woff2": "font/woff2",
    "avif": "image/avif",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "js.map": "application/json",
    "mjs.map": "application/json"
};
const ServerResponse = {
    Page(stream, res) {
        if (MIME_TYPES[res.type]) {
            const headers = {
                "content-type": MIME_TYPES[res.type] + "; charset=utf-8",
                ":status": 200
            };
            let content = res.data;
            if (res.cache > 0)
                headers["cache-control"] = "max-age=" + res.cache;
            if (res.gzip === true) {
                headers["content-encoding"] = "gzip";
                content = zlib_1.default.gzipSync(content);
            }
            stream.respond(headers);
            stream.end(content);
        }
        else {
            console.log("[ServerResponse] Wrong Page Type:", res.type);
        }
    },
    JSON(stream, content, raw_headers) {
        try {
            stream.respond(Object.assign({
                "content-type": "application/json",
                "content-ecoding": "gzip",
                ":status": 200
            }, raw_headers));
            stream.end(zlib_1.default.gzipSync(JSON.stringify(content)));
        }
        catch (err) {
            stream.respond({ ":status": 502 });
            stream.end();
        }
    },
    Empty(stream, content) {
        stream.respond({
            "cache-control": "max-age: 604800",
            ":status": 404
        });
        if (!content)
            content = "[404] Not Found";
        stream.end(content);
    },
    WrongMethod(stream) {
        stream.respond({
            "accept": "GET, POST, HEAD",
            ":status": 405
        });
        stream.end();
    },
    Redirect(stream, location) {
        stream.respond({
            "location": location,
            ":status": 307
        });
        stream.end();
    }
};
class Server {
    server;
    options;
    security = {
        state: false,
        model: undefined,
        field: ""
    };
    extra_ops = {
        login_uri: undefined,
        file_404: undefined
    };
    resources = new Map();
    post_api = new Map();
    constructor(options) {
        // if (!path.isAbsolute(options.key_path) || !path.isAbsolute(options.cert_path)) throw new Error("[Server] Paths must be absolute");
        if (!fs_1.default.existsSync(options.key_path))
            throw new Error("[Server] Key path isn't valid.");
        if (!fs_1.default.existsSync(options.cert_path))
            throw new Error("[Server] Cert path isn't valid.");
        this.server = http2_1.default.createSecureServer({
            key: fs_1.default.readFileSync(options.key_path),
            cert: fs_1.default.readFileSync(options.cert_path),
        });
        this.options = options;
        this.server.on("error", (err) => console.error("[Server] Server error:", err));
        this.server.on("sessionError", (err) => console.error("[Server] Session error:", err));
        this.server.on("connectionError", (err) => console.error("[Server] Connection error:", err));
    }
    helpWithKey() {
        console.log("openssl req -newkey rsa:2048 -nodes -keyout key.pem -x509 -days 365 -out certificate.pem");
    }
    helpWithStatic() {
        console.log(`Pattern for public assets: ./static/public/{file_type}/{file_name}.{file_type}`);
        console.log(`Pattern for private assets: ./static/private/{file_type}/{file_name}.{file_type}`);
    }
    extra({ login_uri, file_path_404 }) {
        this.extra_ops.login_uri = login_uri;
        this.extra_ops.file_404 = fs_1.default.readFileSync(file_path_404);
    }
    secure(model, field) {
        if ((model.getAttributes())[field]) {
            this.security = { state: true, model, field };
        }
        else {
            console.log("[Secure] Model or Field isn't exist");
        }
    }
    start() {
        this.server.listen(this.options.port, this.options.host, () => {
            console.log(`[Server] Listen to: https://${this.options.host}:${this.options.port}`);
        });
        this.server.on("stream", (stream, headers) => {
            let requestBody = "";
            stream.on("data", (chunk) => { requestBody += chunk.toString(); });
            stream.on("end", () => { this.handle_stream(stream, headers, requestBody); });
        });
    }
    hostFile(input) {
        if (fs_1.default.existsSync(input.path)) {
            const res = {
                uri: "",
                data: fs_1.default.readFileSync(input.path),
                safe: false,
                type: "html",
                code: 200,
                cache: 0,
                gzip: false
            };
            delete input.path;
            Object.assign(res, input);
            this.resources.set(input.uri, res);
        }
        else {
            console.log("[HostFile] File not found:", input.path);
        }
    }
    hostDir(input) {
        if (!fs_1.default.existsSync(input.path))
            return console.log("[HostDirectory] Directory not found:", input.path);
        const files = fs_1.default.readdirSync(input.path, { withFileTypes: true });
        for (let file of files) {
            const file_name = file.name.split(".")[0];
            const file_ext = file.name.slice(file_name.length + 1);
            let file_uri = input.uri + "/" + file.name.split(".")[0];
            if (input.uri.indexOf("{") > -1)
                file_uri = input.uri.replaceAll("{0}", file_name).replaceAll("{1}", file_ext);
            const res = {
                uri: file_uri,
                data: fs_1.default.readFileSync(input.path + "/" + file.name),
                safe: false,
                type: file.name.split(".")[1],
                code: 200,
                cache: 0,
                gzip: false
            };
            Object.assign(res, input);
            this.resources.set(file_uri, res);
        }
    }
    hostStatic(input) {
        if (!input.path.endsWith("/static"))
            return console.log("[Autohost] Wrong directory:", input.path);
        // static/public/{ext}/{name}.{ext}
        // static/private/{ext}/{name}.{ext}
        const folders = fs_1.default.readdirSync(input.path, { withFileTypes: true });
        for (let folder of folders) {
            if (folder.isDirectory()) {
                this.recursive_read(folder.parentPath + "/" + folder.name, input);
            }
        }
    }
    recursive_read(_dir, input) {
        const files = fs_1.default.readdirSync(_dir, { withFileTypes: true });
        for (let file of files) {
            if (file.isDirectory()) {
                this.recursive_read(file.parentPath + "/" + file.name, input);
            }
            else {
                if (file.name.startsWith("tsconfig"))
                    continue;
                const file_name = file.name.split(".")[0];
                const file_ext = file.name.slice(file_name.length + 1);
                let file_uri = "/static/" + file.parentPath.split("/static/")[1] + "/" + file.name;
                if (input && input.uri)
                    file_uri = input.uri.replaceAll("{0}", file_name).replaceAll("{1}", file_ext);
                const res = {
                    uri: file_uri,
                    data: fs_1.default.readFileSync(file.parentPath + "/" + file.name),
                    safe: file.parentPath.indexOf("private") > -1,
                    type: file_ext,
                    code: 200,
                    cache: 0,
                    gzip: false
                };
                if (input && input.gzip)
                    res.gzip = input.gzip;
                if (input && input.cache)
                    res.cache = input.cache;
                this.resources.set(file_uri, res);
            }
        }
    }
    async handle_stream(stream, headers, body) {
        const method = headers[":method"];
        const token = headers["cookie"]?.split("Token=")[1]?.split(";")[0];
        let secured = false;
        if (token && this.security.state === true) {
            secured = await this.security.model.findOne({ where: { [this.security.field]: token } }) ? true : false;
        }
        if (method === "GET")
            return this.response_to_get({ stream, headers, body, secured });
        if (method === "POST")
            return this.response_to_post({ stream, headers, body, secured });
        ServerResponse.WrongMethod(stream);
    }
    response_to_get({ stream, headers, body, secured }) {
        const raw_path = headers[":path"];
        const path = (new URL(raw_path, `https://${this.options.host}:${this.options.port}`)).pathname;
        if (this.resources.has(path)) {
            const asset = this.resources.get(path);
            if (asset.safe === true && secured === false)
                return ServerResponse.Redirect(stream, this.extra_ops.login_uri ?? "/login");
            ServerResponse.Page(stream, asset);
        }
        else {
            ServerResponse.Empty(stream, this.extra_ops.file_404);
        }
    }
    post({ uri, safe, fn }) {
        if (!safe)
            safe = false;
        this.post_api.set(uri, { safe, fn });
    }
    response_to_post({ stream, headers, body, secured }) {
        const path = headers[":path"];
        if (this.post_api.has(path)) {
            const asset = this.post_api.get(path);
            if (asset.safe === true && secured === false) {
                stream.respond({ ":status": 401 });
                stream.end("<h1> Secured Page </h1>");
            }
            else {
                asset.fn({ stream, headers, body: JSON.parse(body) });
            }
        }
        else {
            stream.respond({ ":status": 404 });
            stream.end();
        }
    }
}
exports.Server = Server;
//# sourceMappingURL=index.cjs.map
