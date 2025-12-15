//Extract static BB/function map, CFG edges, and call edges to master SQLite database
//@author Your Name
//@category Analysis
//@keybinding
//@menupath
//@toolbar

import ghidra.app.script.GhidraScript;
import ghidra.program.model.block.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.address.*;
import ghidra.program.model.symbol.*;
import ghidra.program.model.mem.*;
import ghidra.program.model.symbol.Symbol;
import ghidra.app.util.demangler.DemangledObject;
import ghidra.framework.options.Options;
import ghidra.util.exception.CancelledException;
import ghidra.app.util.Option;
import java.sql.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.List;

public class ExtractCFGToSQLite extends GhidraScript {

    private Connection conn;
    private Map<Address, Integer> funcIdMap;
    private int binaryId;

    @Override
    public void run() throws Exception {
        // Get command-line arguments
        String[] args = getScriptArgs();

        File dbFile;
        if (args.length > 0) {
            // Headless mode: use provided argument
            dbFile = new File(args[0]);
            println("Using database file: " + dbFile.getAbsolutePath());
        } else {
            // GUI mode: ask user
            dbFile = askFile("Select Master SQLite Database", "Save/Open");
            if (dbFile == null) {
                println("No file selected. Exiting.");
                return;
            }
        }

        // Initialize database (creates if doesn't exist)
        initDatabase(dbFile);

        try {
            // Register or update this binary
            println("Registering binary...");
            registerBinary();

            // Extract data
            println("Extracting functions and basic blocks...");
            extractFunctionsAndBasicBlocks();

            println("Extracting CFG edges...");
            extractCFGEdges();

            println("Extracting call edges...");
            extractCallEdges();

            println("Extraction complete!");
            println("Data saved to: " + dbFile.getAbsolutePath());
            println("Binary ID: " + binaryId);

        } finally {
            // Close database connection
            if (conn != null) {
                conn.close();
            }
        }
    }

    private void initDatabase(File dbFile) throws SQLException {
        // Connect to SQLite database (creates file if doesn't exist)
        String url = "jdbc:sqlite:" + dbFile.getAbsolutePath();
        conn = DriverManager.getConnection(url);
        conn.setAutoCommit(false);

        // Create tables if they don't exist
        Statement stmt = conn.createStatement();

        // Analyzed binaries table
        stmt.execute("CREATE TABLE IF NOT EXISTS analyzed_binaries (" +
                "binary_id INTEGER PRIMARY KEY AUTOINCREMENT, " +
                "project_name TEXT NOT NULL, " +
                "binary_name TEXT NOT NULL, " +
                "sha256_hash TEXT NOT NULL UNIQUE, " +
                "timedatestamp INTEGER, " +
                "imagesize INTEGER, " +
                "version TEXT, " +
                "analysis_timestamp INTEGER NOT NULL)");

        // Functions table - ADD func_size column
        stmt.execute("CREATE TABLE IF NOT EXISTS functions (" +
                "binary_id INTEGER NOT NULL, " +
                "func_id INTEGER NOT NULL, " +
                "func_name TEXT NOT NULL, " +
                "entry_rva INTEGER NOT NULL, " +
                "start_va INTEGER NOT NULL, " +
                "end_va INTEGER NOT NULL, " +
                "func_size INTEGER NOT NULL, " +  // NEW
                "PRIMARY KEY (binary_id, func_id), " +
                "FOREIGN KEY (binary_id) REFERENCES analyzed_binaries(binary_id))");

        // Basic blocks table - ADD bb_size column
        stmt.execute("CREATE TABLE IF NOT EXISTS basic_blocks (" +
                "binary_id INTEGER NOT NULL, " +
                "func_id INTEGER NOT NULL, " +
                "func_name TEXT NOT NULL, " +
                "bb_rva INTEGER NOT NULL, " +
                "bb_start_va INTEGER NOT NULL, " +
                "bb_end_va INTEGER NOT NULL, " +
                "PRIMARY KEY (binary_id, bb_rva), " +
                "FOREIGN KEY (binary_id) REFERENCES analyzed_binaries(binary_id))");


        // CFG edges table
        stmt.execute("CREATE TABLE IF NOT EXISTS cfg_edges (" +
                "binary_id INTEGER NOT NULL, " +
                "func_id INTEGER NOT NULL, " +
                "src_bb_rva INTEGER NOT NULL, " +
                "dst_bb_rva INTEGER NOT NULL, " +
                "edge_kind TEXT, " +
                "FOREIGN KEY (binary_id) REFERENCES analyzed_binaries(binary_id))");

        // Call edges (direct) table
        stmt.execute("CREATE TABLE IF NOT EXISTS call_edges_static (" +
                "binary_id INTEGER NOT NULL, " +
                "src_bb_rva INTEGER NOT NULL, " +
                "src_func_id INTEGER NOT NULL, " +
                "dst_func_id INTEGER, " +
                "call_kind TEXT, " +
                "FOREIGN KEY (binary_id) REFERENCES analyzed_binaries(binary_id))");

        // Call sites (indirect) table
        stmt.execute("CREATE TABLE IF NOT EXISTS call_sites_indirect (" +
                "binary_id INTEGER NOT NULL, " +
                "src_bb_rva INTEGER NOT NULL, " +
                "src_func_id INTEGER NOT NULL, " +
                "call_kind TEXT, " +
                "FOREIGN KEY (binary_id) REFERENCES analyzed_binaries(binary_id))");

        // Create indices for performance
        stmt.execute("CREATE INDEX IF NOT EXISTS idx_functions_binary ON functions(binary_id)");
        stmt.execute("CREATE INDEX IF NOT EXISTS idx_basic_blocks_binary ON basic_blocks(binary_id)");
        stmt.execute("CREATE INDEX IF NOT EXISTS idx_cfg_edges_binary ON cfg_edges(binary_id)");
        stmt.execute("CREATE INDEX IF NOT EXISTS idx_call_edges_binary ON call_edges_static(binary_id)");
        stmt.execute("CREATE INDEX IF NOT EXISTS idx_call_sites_binary ON call_sites_indirect(binary_id)");

        stmt.close();
        conn.commit();

        funcIdMap = new HashMap<>();
    }

    private void registerBinary() throws Exception {
        // Calculate SHA256 hash
        String sha256Hash = calculateSHA256();
        println("SHA256: " + sha256Hash);

        // Extract binary metadata
        String projectName = currentProgram.getDomainFile().getProjectLocator().getName();
        String binaryName = currentProgram.getName();
        Long timestamp = extractTimestamp();
        Long imageSize = extractImageSize();
        String version = extractVersion();
        long analysisTimestamp = System.currentTimeMillis() / 1000;

        println("Binary metadata:");
        println("  Project: " + projectName);
        println("  Name: " + binaryName);
        println("  Timestamp: " + (timestamp != null ? "0x" + Long.toHexString(timestamp) : "N/A"));
        println("  Image Size: " + (imageSize != null ? "0x" + Long.toHexString(imageSize) : "N/A"));
        println("  Version: " + (version != null ? version : "N/A"));

        // Check if binary already exists (by SHA256 hash)
        PreparedStatement checkStmt = conn.prepareStatement(
                "SELECT binary_id FROM analyzed_binaries WHERE sha256_hash = ?");
        checkStmt.setString(1, sha256Hash);
        ResultSet rs = checkStmt.executeQuery();

        if (rs.next()) {
            // Binary exists - delete old data and update
            binaryId = rs.getInt("binary_id");
            println("Binary already exists (ID: " + binaryId + "). Overwriting old data...");

            // Delete old data in reverse order of dependencies
            PreparedStatement delStmt = conn.prepareStatement(
                    "DELETE FROM call_sites_indirect WHERE binary_id = ?");
            delStmt.setInt(1, binaryId);
            delStmt.executeUpdate();
            delStmt.close();

            delStmt = conn.prepareStatement("DELETE FROM call_edges_static WHERE binary_id = ?");
            delStmt.setInt(1, binaryId);
            delStmt.executeUpdate();
            delStmt.close();

            delStmt = conn.prepareStatement("DELETE FROM cfg_edges WHERE binary_id = ?");
            delStmt.setInt(1, binaryId);
            delStmt.executeUpdate();
            delStmt.close();

            delStmt = conn.prepareStatement("DELETE FROM basic_blocks WHERE binary_id = ?");
            delStmt.setInt(1, binaryId);
            delStmt.executeUpdate();
            delStmt.close();

            delStmt = conn.prepareStatement("DELETE FROM functions WHERE binary_id = ?");
            delStmt.setInt(1, binaryId);
            delStmt.executeUpdate();
            delStmt.close();

            // Update binary record with new metadata
            PreparedStatement updateStmt = conn.prepareStatement(
                    "UPDATE analyzed_binaries SET project_name = ?, binary_name = ?, " +
                            "timedatestamp = ?, imagesize = ?, version = ?, analysis_timestamp = ? " +
                            "WHERE binary_id = ?");
            updateStmt.setString(1, projectName);
            updateStmt.setString(2, binaryName);
            if (timestamp != null)
                updateStmt.setLong(3, timestamp);
            else
                updateStmt.setNull(3, Types.INTEGER);
            if (imageSize != null)
                updateStmt.setLong(4, imageSize);
            else
                updateStmt.setNull(4, Types.INTEGER);
            updateStmt.setString(5, version);
            updateStmt.setLong(6, analysisTimestamp);
            updateStmt.setInt(7, binaryId);
            updateStmt.executeUpdate();
            updateStmt.close();

        } else {
            // New binary - insert
            println("New binary detected. Adding to database...");
            PreparedStatement insertStmt = conn.prepareStatement(
                    "INSERT INTO analyzed_binaries (project_name, binary_name, sha256_hash, " +
                            "timedatestamp, imagesize, version, analysis_timestamp) " +
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    Statement.RETURN_GENERATED_KEYS);
            insertStmt.setString(1, projectName);
            insertStmt.setString(2, binaryName);
            insertStmt.setString(3, sha256Hash);
            if (timestamp != null)
                insertStmt.setLong(4, timestamp);
            else
                insertStmt.setNull(4, Types.INTEGER);
            if (imageSize != null)
                insertStmt.setLong(5, imageSize);
            else
                insertStmt.setNull(5, Types.INTEGER);
            insertStmt.setString(6, version);
            insertStmt.setLong(7, analysisTimestamp);
            insertStmt.executeUpdate();

            ResultSet generatedKeys = insertStmt.getGeneratedKeys();
            if (generatedKeys.next()) {
                binaryId = generatedKeys.getInt(1);
            }
            insertStmt.close();
        }

        rs.close();
        checkStmt.close();
        conn.commit();
    }

    private String calculateSHA256() throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        Memory memory = currentProgram.getMemory();

        // Hash all loaded memory blocks
        for (MemoryBlock block : memory.getBlocks()) {
            if (block.isInitialized() && !block.isExternalBlock()) {
                byte[] blockBytes = new byte[(int) block.getSize()];
                block.getBytes(block.getStart(), blockBytes);
                digest.update(blockBytes);
            }
        }

        byte[] hashBytes = digest.digest();
        StringBuilder sb = new StringBuilder();
        for (byte b : hashBytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private Long extractImageSize() {
        try {
            String[] optionLists = { "Program Information", "PE", "Executable Format" };

            for (String listName : optionLists) {
                Options props = currentProgram.getOptions(listName);
                List<String> propNames = props.getOptionNames();

                // Print all properties in this list (only once)
                if (listName.equals("PE") || listName.equals("Executable Format")) {
                    println("Properties in '" + listName + "': " + propNames);
                }

                // Try different size property names
                for (String propName : propNames) {
                    if (propName.toLowerCase().contains("size") &&
                            propName.toLowerCase().contains("image")) {
                        Object value = props.getObject(propName, null);
                        println("  Found image size property: " + propName + " = " + value);

                        if (value != null) {
                            String valueStr = value.toString();
                            if (valueStr.startsWith("0x") || valueStr.startsWith("0X")) {
                                return Long.parseLong(valueStr.substring(2), 16);
                            } else if (valueStr.matches("\\d+")) {
                                return Long.parseLong(valueStr);
                            }
                        }
                    }
                }
            }

            // Fallback: Read from PE header directly
            String executable = currentProgram.getExecutableFormat();
            if (executable != null && executable.toLowerCase().contains("pe")) {
                Memory memory = currentProgram.getMemory();
                Address imageBase = currentProgram.getImageBase();

                byte[] dosSignature = new byte[2];
                memory.getBytes(imageBase, dosSignature);

                if (dosSignature[0] == 'M' && dosSignature[1] == 'Z') {
                    byte[] lfanewBytes = new byte[4];
                    memory.getBytes(imageBase.add(0x3C), lfanewBytes);
                    int lfanew = ((lfanewBytes[3] & 0xFF) << 24) |
                            ((lfanewBytes[2] & 0xFF) << 16) |
                            ((lfanewBytes[1] & 0xFF) << 8) |
                            (lfanewBytes[0] & 0xFF);

                    Address sizeOfImageAddr = imageBase.add(lfanew + 0x50);
                    byte[] sizeBytes = new byte[4];
                    memory.getBytes(sizeOfImageAddr, sizeBytes);

                    long size = ((sizeBytes[3] & 0xFFL) << 24) |
                            ((sizeBytes[2] & 0xFFL) << 16) |
                            ((sizeBytes[1] & 0xFFL) << 8) |
                            (sizeBytes[0] & 0xFFL);

                    if (size > 0 && size < 0x10000000) {
                        return size;
                    }
                }
            }
        } catch (Exception e) {
            println("Warning: Could not extract image size: " + e.getMessage());
        }
        return null;
    }

    private Long extractTimestamp() {
        try {
            // Access PE header directly from memory
            Memory memory = currentProgram.getMemory();
            Address imageBase = currentProgram.getImageBase();

            // Check for MZ signature
            byte[] dosSignature = new byte[2];
            memory.getBytes(imageBase, dosSignature);

            if (dosSignature[0] == 'M' && dosSignature[1] == 'Z') {
                // Read e_lfanew at offset 0x3C (points to PE signature)
                byte[] lfanewBytes = new byte[4];
                memory.getBytes(imageBase.add(0x3C), lfanewBytes);
                int lfanew = ((lfanewBytes[3] & 0xFF) << 24) |
                        ((lfanewBytes[2] & 0xFF) << 16) |
                        ((lfanewBytes[1] & 0xFF) << 8) |
                        (lfanewBytes[0] & 0xFF);

                // PE signature is at lfanew, followed by COFF File Header
                // TimeDateStamp is at lfanew + 0x8 (4 bytes after PE signature + 2 bytes
                // Machine + 2 bytes NumberOfSections)
                Address timestampAddr = imageBase.add(lfanew + 0x8);
                byte[] timestampBytes = new byte[4];
                memory.getBytes(timestampAddr, timestampBytes);

                long timestamp = ((timestampBytes[3] & 0xFFL) << 24) |
                        ((timestampBytes[2] & 0xFFL) << 16) |
                        ((timestampBytes[1] & 0xFFL) << 8) |
                        (timestampBytes[0] & 0xFFL);

                return timestamp;
            }
        } catch (Exception e) {
            println("Warning: Could not extract timestamp: " + e.getMessage());
        }
        return null;
    }

    private String extractVersion() {
        try {
            // Check for VERSION_INFO resource
            Memory memory = currentProgram.getMemory();

            // Look for version strings in .rsrc section or common locations
            MemoryBlock rsrcBlock = memory.getBlock(".rsrc");
            if (rsrcBlock != null) {
                // Search for common version string patterns
                Address start = rsrcBlock.getStart();
                Address end = rsrcBlock.getEnd();

                // Look for "FileVersion" string
                byte[] pattern = "FileVersion".getBytes("UTF-16LE");
                Address found = memory.findBytes(start, end, pattern, null, true, monitor);

                if (found != null) {
                    // Try to find the actual version number nearby (simplified)
                    // This is a basic approach - proper parsing would need full resource structure
                    byte[] versionData = new byte[64];
                    Address versionStart = found.add(pattern.length + 4);
                    memory.getBytes(versionStart, versionData);

                    // Look for version pattern like "1.0.0.0" in UTF-16LE
                    StringBuilder version = new StringBuilder();
                    for (int i = 0; i < versionData.length - 1; i += 2) {
                        char c = (char) (versionData[i] & 0xFF | (versionData[i + 1] & 0xFF) << 8);
                        if ((c >= '0' && c <= '9') || c == '.') {
                            version.append(c);
                        } else if (version.length() > 0) {
                            break;
                        }
                    }

                    if (version.length() > 0) {
                        return version.toString();
                    }
                }
            }

            // Fallback: Check program properties
            Options props = currentProgram.getOptions("Program Information");
            List<String> propNames = props.getOptionNames();

            for (String propName : propNames) {
                if (propName.toLowerCase().contains("version") &&
                        !propName.toLowerCase().contains("ghidra")) {
                    Object value = props.getObject(propName, null);
                    if (value != null && !value.toString().isEmpty()) {
                        return value.toString();
                    }
                }
            }
        } catch (Exception e) {
            println("Warning: Could not extract version: " + e.getMessage());
        }
        return null;
    }

    private String getFunctionName(Function function) {
        SymbolTable symbolTable = function.getProgram().getSymbolTable();
        Symbol[] symbols = symbolTable.getSymbols(function.getEntryPoint());

        String demangledName = function.getName();

        // Look through all symbols at this address for the mangled version
        for (Symbol symbol : symbols) {
            String name = symbol.getName();
            // The mangled symbol is different from the demangled name
            if (!name.equals(demangledName)) {
                return name; // Return the mangled/decorated name
            }
        }

        // No mangled version found, return the demangled name
        return demangledName;
    }

    private void extractFunctionsAndBasicBlocks() throws SQLException, CancelledException {
        FunctionManager funcMgr = currentProgram.getFunctionManager();
        BasicBlockModel bbModel = new BasicBlockModel(currentProgram);
        Address imageBase = currentProgram.getImageBase();

        // CLEAR the funcIdMap at the start to ensure no stale data
        funcIdMap.clear();

        PreparedStatement funcStmt = conn.prepareStatement(
                "INSERT INTO functions (binary_id, func_id, func_name, entry_rva, start_va, end_va, func_size) " +
                        "VALUES (?, ?, ?, ?, ?, ?, ?)"); // Added func_size

        PreparedStatement bbStmt = conn.prepareStatement(
                "INSERT INTO basic_blocks (binary_id, func_id, func_name, bb_rva, bb_start_va, bb_end_va) " +
                        "VALUES (?, ?, ?, ?, ?, ?)");

        int nextFuncId = 1;
        int functionCount = 0;
        int bbCount = 0;

        // Iterate through all functions
        for (Function func : funcMgr.getFunctions(true)) {
            Address entryPoint = func.getEntryPoint();
            long entryRVA = entryPoint.subtract(imageBase);
            int funcId = nextFuncId++;

            // Verify no duplicate entry point
            if (funcIdMap.containsKey(entryPoint)) {
                println("WARNING: Duplicate function entry point at " + entryPoint + "! Skipping.");
                continue;
            }

            funcIdMap.put(entryPoint, funcId);

            // Get function bounds
            AddressSetView funcBody = func.getBody();
            Address funcStart = funcBody.getMinAddress();
            Address funcEnd = funcBody.getMaxAddress();

            // Calculate function size in bytes
            long funcSize = funcBody.getNumAddresses(); // NEW

            // Get function name
            String name = func.getName(true);

            // Insert function record
            funcStmt.setInt(1, binaryId);
            funcStmt.setInt(2, funcId);
            funcStmt.setString(3, name);
            funcStmt.setLong(4, entryRVA);
            funcStmt.setLong(5, funcStart.getOffset());
            funcStmt.setLong(6, funcEnd.getOffset());
            funcStmt.setLong(7, funcSize); // NEW
            funcStmt.addBatch();
            functionCount++;

            // Get basic blocks for this function
            CodeBlockIterator bbIter = bbModel.getCodeBlocksContaining(funcBody, monitor);
            while (bbIter.hasNext()) {
                CodeBlock bb = bbIter.next();
                Address bbStart = bb.getFirstStartAddress();
                Address bbEnd = bb.getMaxAddress();
                long bbRVA = bbStart.subtract(imageBase);

                // Calculate basic block size in bytes
                long bbSize = bbEnd.subtract(bbStart) + 1; // NEW

                // Insert basic block record
                bbStmt.setInt(1, binaryId);
                bbStmt.setInt(2, funcId);
                bbStmt.setString(3, name);
                bbStmt.setLong(4, bbRVA);
                bbStmt.setLong(5, bbStart.getOffset());
                bbStmt.setLong(6, bbEnd.getOffset());
                bbStmt.addBatch();
                bbCount++;
            }
        }

        funcStmt.executeBatch();
        bbStmt.executeBatch();
        conn.commit();

        println("Extracted " + functionCount + " functions and " + bbCount + " basic blocks.");
        println("funcIdMap size: " + funcIdMap.size());

        funcStmt.close();
        bbStmt.close();
    }

    private void extractCFGEdges() throws SQLException, CancelledException {
        BasicBlockModel bbModel = new BasicBlockModel(currentProgram);
        FunctionManager funcMgr = currentProgram.getFunctionManager();
        Address imageBase = currentProgram.getImageBase();

        PreparedStatement cfgStmt = conn.prepareStatement(
                "INSERT INTO cfg_edges (binary_id, func_id, src_bb_rva, dst_bb_rva, edge_kind) " +
                        "VALUES (?, ?, ?, ?, ?)");

        int edgeCount = 0;

        // Iterate through all functions
        for (Function func : funcMgr.getFunctions(true)) {
            Address entryPoint = func.getEntryPoint();
            Integer funcId = funcIdMap.get(entryPoint);
            if (funcId == null)
                continue;

            AddressSetView funcBody = func.getBody();
            CodeBlockIterator bbIter = bbModel.getCodeBlocksContaining(funcBody, monitor);

            while (bbIter.hasNext()) {
                CodeBlock srcBB = bbIter.next();
                Address srcAddr = srcBB.getFirstStartAddress();
                long srcRVA = srcAddr.subtract(imageBase);

                // Get destination blocks (successors)
                CodeBlockReferenceIterator destIter = srcBB.getDestinations(monitor);
                while (destIter.hasNext()) {
                    CodeBlockReference destRef = destIter.next();
                    CodeBlock destBB = destRef.getDestinationBlock();
                    Address destAddr = destBB.getFirstStartAddress();

                    // Check if destination is within the same function
                    if (funcBody.contains(destAddr)) {
                        long destRVA = destAddr.subtract(imageBase);
                        FlowType flowType = destRef.getFlowType();
                        String edgeKind = getEdgeKind(flowType);

                        cfgStmt.setInt(1, binaryId);
                        cfgStmt.setInt(2, funcId);
                        cfgStmt.setLong(3, srcRVA);
                        cfgStmt.setLong(4, destRVA);
                        cfgStmt.setString(5, edgeKind);
                        cfgStmt.addBatch();
                        edgeCount++;
                    }
                }
            }
        }

        cfgStmt.executeBatch();
        conn.commit();

        println("Extracted " + edgeCount + " CFG edges.");

        cfgStmt.close();
    }

    private void extractCallEdges() throws SQLException, CancelledException {
        FunctionManager funcMgr = currentProgram.getFunctionManager();
        BasicBlockModel bbModel = new BasicBlockModel(currentProgram);
        Address imageBase = currentProgram.getImageBase();

        PreparedStatement directCallStmt = conn.prepareStatement(
                "INSERT INTO call_edges_static (binary_id, src_bb_rva, src_func_id, dst_func_id, call_kind) " +
                        "VALUES (?, ?, ?, ?, ?)");

        PreparedStatement indirectCallStmt = conn.prepareStatement(
                "INSERT INTO call_sites_indirect (binary_id, src_bb_rva, src_func_id, call_kind) " +
                        "VALUES (?, ?, ?, ?)");

        int directCount = 0;
        int indirectCount = 0;

        // Iterate through all functions
        for (Function srcFunc : funcMgr.getFunctions(true)) {
            Address srcEntry = srcFunc.getEntryPoint();
            Integer srcFuncId = funcIdMap.get(srcEntry);
            if (srcFuncId == null)
                continue;

            AddressSetView funcBody = srcFunc.getBody();
            InstructionIterator instIter = currentProgram.getListing().getInstructions(funcBody, true);

            while (instIter.hasNext() && !monitor.isCancelled()) {
                Instruction inst = instIter.next();
                Address instAddr = inst.getAddress();
                FlowType flowType = inst.getFlowType();

                // Check if instruction is a call
                if (flowType.isCall()) {
                    // Find the basic block containing this instruction
                    CodeBlock[] blocks = bbModel.getCodeBlocksContaining(instAddr, monitor);
                    if (blocks.length == 0)
                        continue;

                    Address bbAddr = blocks[0].getFirstStartAddress();
                    long bbRVA = bbAddr.subtract(imageBase);

                    // Get call references from this instruction
                    Reference[] refs = inst.getReferencesFrom();
                    boolean hasDirectCall = false;

                    for (Reference ref : refs) {
                        if (ref.getReferenceType().isCall()) {
                            Address toAddr = ref.getToAddress();

                            if (ref.getReferenceType().isComputed() ||
                                    !toAddr.isMemoryAddress()) {
                                // Indirect or computed call
                                indirectCallStmt.setInt(1, binaryId);
                                indirectCallStmt.setLong(2, bbRVA);
                                indirectCallStmt.setInt(3, srcFuncId);
                                indirectCallStmt.setString(4, "indirect_unknown");
                                indirectCallStmt.addBatch();
                                indirectCount++;
                                hasDirectCall = true;
                            } else {
                                // Direct call
                                Function dstFunc = funcMgr.getFunctionAt(toAddr);
                                if (dstFunc != null) {
                                    Integer dstFuncId = funcIdMap.get(dstFunc.getEntryPoint());
                                    if (dstFuncId != null) {
                                        directCallStmt.setInt(1, binaryId);
                                        directCallStmt.setLong(2, bbRVA);
                                        directCallStmt.setInt(3, srcFuncId);
                                        directCallStmt.setInt(4, dstFuncId);
                                        directCallStmt.setString(5, "direct");
                                        directCallStmt.addBatch();
                                        directCount++;
                                        hasDirectCall = true;
                                    }
                                }
                            }
                        }
                    }

                    // If no references found but it's a call, treat as indirect
                    if (!hasDirectCall && refs.length == 0) {
                        indirectCallStmt.setInt(1, binaryId);
                        indirectCallStmt.setLong(2, bbRVA);
                        indirectCallStmt.setInt(3, srcFuncId);
                        indirectCallStmt.setString(4, "indirect_unknown");
                        indirectCallStmt.addBatch();
                        indirectCount++;
                    }
                }
            }
        }

        directCallStmt.executeBatch();
        indirectCallStmt.executeBatch();
        conn.commit();

        println("Extracted " + directCount + " direct calls and " + indirectCount + " indirect calls.");

        directCallStmt.close();
        indirectCallStmt.close();
    }

    private String getEdgeKind(FlowType flowType) {
        if (flowType.isFallthrough()) {
            return "fallthrough";
        } else if (flowType.isUnConditional()) {
            return "branch_unconditional";
        } else if (flowType.isConditional()) {
            return "branch_conditional";
        } else if (flowType.isTerminal()) {
            return "return";
        } else if (flowType.isJump()) {
            return "branch";
        } else {
            return "other";
        }
    }
}
