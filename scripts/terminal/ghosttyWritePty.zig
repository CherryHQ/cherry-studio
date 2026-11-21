extern "env" fn t3_write_pty(terminal: u32, userdata: u32, data: u32, len: u32) void;

export fn ghostty_write_pty(terminal: u32, userdata: u32, data: u32, len: u32) void {
    t3_write_pty(terminal, userdata, data, len);
}

extern "env" fn cherry_alloc(ctx: u32, len: u32, alignment: u32) u32;
extern "env" fn cherry_free(ctx: u32, memory: u32) void;

export fn ghostty_allocator_alloc(ctx: u32, len: u32, alignment: u8, _: u32) u32 {
    return cherry_alloc(ctx, len, alignment);
}

export fn ghostty_allocator_free(ctx: u32, memory: u32, _: u32, _: u8, _: u32) void {
    cherry_free(ctx, memory);
}
