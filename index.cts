import http2 from "http2";
import zlib from "zlib";
import path from "path";
import fs from "fs";

const MIME_TYPES = {
    "html": "text/html",
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
}

const ServerResponse = {
    Page(stream: http2.ServerHttp2Stream, res: Resource) {
        if (MIME_TYPES[res.type]) {
            const headers = {
                "content-type": MIME_TYPES[res.type] + "; charset=utf-8",
                ":status": 200
            }
            let content = res.data;
            if (res.cache > 0) headers["cache-control"] = "max-age=" + res.cache;
            if (res.gzip === true) {
                headers["content-encoding"] = "gzip";
                content = zlib.gzipSync(content);
            }
            stream.respond(headers);
            stream.end(content);
        } else {
            console.log("[ServerResponse] Wrong Page Type:", res.type);
        }
    },
    JSON(stream: http2.ServerHttp2Stream, content: any, raw_headers?: any) {
        try {
            stream.respond(Object.assign({
                "content-type": "application/json",
                "content-ecoding": "gzip",
                ":status": 200
            }, raw_headers));
            stream.end(zlib.gzipSync(JSON.stringify(content)));
        } catch (err) {
            stream.respond({ ":status": 502 });
            stream.end();
        }
    },
    Empty(stream: http2.ServerHttp2Stream, content?: any) {
        stream.respond({
            "cache-control": "max-age: 604800",
            ":status": 404
        });
        if (!content) content = "[404] Not Found";
        stream.end(content);
    },
    WrongMethod(stream: http2.ServerHttp2Stream) {
        stream.respond({
            "accept": "GET, POST, HEAD",
            ":status": 405
        });
        stream.end();
    },
    Redirect(stream: http2.ServerHttp2Stream, location: string) {
        stream.respond({
            "location": location,
            ":status": 307
        });
        stream.end();
    }
}

interface ServerOptions {
    host: string;
    port: number;
    key_path: string;
    cert_path: string;
}

interface IncomingStream {
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
    body: string,
    secured: boolean
}

interface InputData {
    uri: string;
    path: string;
    type?: string;
    code?: number;
    cache?: number
    safe?: boolean;
    gzip?: boolean;
}
interface InputStaticData {
    path: string;
    uri?: string;
    cache?: number;
    gzip?: boolean;
}
interface Resource {
    uri: string;
    data: Buffer;
    type: string;
    code: number;
    cache: number
    safe: boolean;
    gzip: boolean;
}

interface PostFn {
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
    body: any
}
interface InputPostData {
    uri: string;
    safe?: boolean;
    fn: ({ stream, headers, body }: PostFn) => any;
}

interface ResourcePost {
    safe: boolean;
    fn: ({ stream, headers, body }: PostFn) => any;
}

export class Server {
    server: http2.Http2SecureServer;
    options: ServerOptions;
    security: { state: boolean, model: any, field: string } = {
        state: false,
        model: undefined,
        field: ""
    };

    extra_ops = {
        login_uri: undefined,
        file_404: undefined
    };

    resources: Map<string, Resource> = new Map();
    post_api: Map<string, ResourcePost> = new Map();

    constructor(options: ServerOptions) {
        // if (!path.isAbsolute(options.key_path) || !path.isAbsolute(options.cert_path)) throw new Error("[Server] Paths must be absolute");
        if (!fs.existsSync(options.key_path)) throw new Error("[Server] Key path isn't valid.");
        if (!fs.existsSync(options.cert_path)) throw new Error("[Server] Cert path isn't valid.");

        this.server = http2.createSecureServer({
            key: fs.readFileSync(options.key_path),
            cert: fs.readFileSync(options.cert_path),
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
    extra({ login_uri, file_path_404 }: { login_uri?: string, file_path_404?: string }) {
        this.extra_ops.login_uri = login_uri;
        this.extra_ops.file_404 = fs.readFileSync(file_path_404);
    }
    secure(model: any, field: string) {
        if ((model.getAttributes())[field]) {
            this.security = { state: true, model, field };
        } else {
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
    hostFile(input: InputData) {
        if (fs.existsSync(input.path)) {
            const res: Resource = {
                uri: "",
                data: fs.readFileSync(input.path),
                safe: false,
                type: "html",
                code: 200,
                cache: 0,
                gzip: false
            }
            delete input.path;
            Object.assign(res, input);

            this.resources.set(input.uri, res);
        } else {
            console.log("[HostFile] File not found:", input.path);
        }
    }
    hostDir(input: InputData) {
        if (!fs.existsSync(input.path)) return console.log("[HostDirectory] Directory not found:", input.path);
        const files = fs.readdirSync(input.path, { withFileTypes: true });
        for (let file of files) {
            const file_name = file.name.split(".")[0];
            const file_ext = file.name.slice(file_name.length + 1);

            let file_uri = input.uri + "/" + file.name.split(".")[0];
            if (input.uri.indexOf("{") > -1) file_uri = input.uri.replaceAll("{0}", file_name).replaceAll("{1}", file_ext);

            const res: Resource = {
                uri: file_uri,
                data: fs.readFileSync(input.path + "/" + file.name),
                safe: false,
                type: file.name.split(".")[1],
                code: 200,
                cache: 0,
                gzip: false
            }
            Object.assign(res, input);
            this.resources.set(file_uri, res);
        }
    }
    hostStatic(input: InputStaticData) {
        if (!input.path.endsWith("/static")) return console.log("[Autohost] Wrong directory:", input.path);
        // static/public/{ext}/{name}.{ext}
        // static/private/{ext}/{name}.{ext}
        const folders = fs.readdirSync(input.path, { withFileTypes: true });

        for (let folder of folders) {
            if (folder.isDirectory()) {
                this.recursive_read(folder.parentPath + "/" + folder.name, input);
            }
        }
    }
    private recursive_read(_dir: string, input: InputStaticData) {
        const files = fs.readdirSync(_dir, { withFileTypes: true });
        for (let file of files) {
            if (file.isDirectory()) {
                this.recursive_read(file.parentPath + "/" + file.name, input);
            } else {
                if (file.name.startsWith("tsconfig")) continue;

                const file_name = file.name.split(".")[0];
                const file_ext = file.name.slice(file_name.length + 1);

                let file_uri = "/static/" + file.parentPath.split("/static/")[1] + "/" + file.name;
                if (input && input.uri) file_uri = input.uri.replaceAll("{0}", file_name).replaceAll("{1}", file_ext);

                const res: Resource = {
                    uri: file_uri,
                    data: fs.readFileSync(file.parentPath + "/" + file.name),
                    safe: file.parentPath.indexOf("private") > -1,
                    type: file_ext,
                    code: 200,
                    cache: 0,
                    gzip: false
                }
                if (input && input.gzip) res.gzip = input.gzip;
                if (input && input.cache) res.cache = input.cache;

                this.resources.set(file_uri, res);
            }
        }
    }
    private async handle_stream(stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders, body: string) {
        const method = headers[":method"];
        const token = headers["cookie"]?.split("Token=")[1]?.split(";")[0];
        let secured = false;

        if (token && this.security.state === true) {
            secured = await this.security.model.findOne({ where: { [this.security.field]: token } }) ? true : false;
        }
        if (method === "GET") return this.response_to_get({ stream, headers, body, secured });
        if (method === "POST") return this.response_to_post({ stream, headers, body, secured });

        ServerResponse.WrongMethod(stream);
    }
    private response_to_get({ stream, headers, body, secured }: IncomingStream) {
        const raw_path = headers[":path"];
        const path = (new URL(raw_path, `https://${this.options.host}:${this.options.port}`)).pathname;

        if (this.resources.has(path)) {
            const asset = this.resources.get(path);
            if (asset.safe === true && secured === false) return ServerResponse.Redirect(stream, this.extra_ops.login_uri ?? "/login");
            ServerResponse.Page(stream, asset);
        } else {
            ServerResponse.Empty(stream, this.extra_ops.file_404);
        }
    }
    post({ uri, safe, fn }: InputPostData) {
        if (!safe) safe = false;
        this.post_api.set(uri, { safe, fn });
    }
    private response_to_post({ stream, headers, body, secured }: IncomingStream) {
        const path = headers[":path"];
        if (this.post_api.has(path)) {
            const asset = this.post_api.get(path);
            if (asset.safe === true && secured === false) {
                stream.respond({ ":status": 401 });
                stream.end("<h1> Secured Page </h1>");
            } else {
                asset.fn({ stream, headers, body: JSON.parse(body) });
            }
        } else {
            stream.respond({ ":status": 404 });
            stream.end();
        }
    }
}
