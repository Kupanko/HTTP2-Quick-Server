import http2 from "http2";
interface ServerOptions {
    host: string;
    port: number;
    key_path: string;
    cert_path: string;
}
interface InputData {
    uri: string;
    path: string;
    type?: string;
    code?: number;
    cache?: number;
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
    cache: number;
    safe: boolean;
    gzip: boolean;
}
interface PostFn {
    stream: http2.ServerHttp2Stream;
    headers: http2.IncomingHttpHeaders;
    body: any;
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
export declare class Server {
    server: http2.Http2SecureServer;
    options: ServerOptions;
    security: {
        state: boolean;
        model: any;
        field: string;
    };
    extra_ops: {
        login_uri: any;
        file_404: any;
    };
    resources: Map<string, Resource>;
    post_api: Map<string, ResourcePost>;
    constructor(options: ServerOptions);
    helpWithKey(): void;
    helpWithStatic(): void;
    extra({ login_uri, file_path_404 }: {
        login_uri?: string;
        file_path_404?: string;
    }): void;
    secure(model: any, field: string): void;
    start(): void;
    hostFile(input: InputData): void;
    hostDir(input: InputData): void;
    hostStatic(input: InputStaticData): void;
    private recursive_read;
    private handle_stream;
    private response_to_get;
    post({ uri, safe, fn }: InputPostData): void;
    private response_to_post;
}
export {};
