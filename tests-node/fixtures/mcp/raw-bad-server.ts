if (process.env.AGENTMESH_FAKE_MCP_GARBAGE_STDOUT) {
  process.stdout.write("not-json\n");
} else {
  process.stdout.write('{"jsonrpc":"2.0","id":1,"result":{}\n');
}

process.stdin.resume();
process.stdin.on("end", () => process.exit(0));
