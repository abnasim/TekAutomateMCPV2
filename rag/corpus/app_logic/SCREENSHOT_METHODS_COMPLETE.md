# Screenshot Capture Methods - Complete Reference

## Summary Table

| Method | Scope Models | Protocol | Speed | Complexity |
|--------|-------------|----------|-------|------------|
| **HARDCOPY:DATA?** | Legacy only (MSO/DPO 5k/7k/70k) | Query (stream bytes) | Fast | Simple |
| **HARDCOPY PORT FILE** | Legacy only (MSO/DPO 5k/7k/70k) | Write to file + transfer | Medium | Medium |
| **SAVE:IMAGE + FILESYSTEM** | Modern only (MSO5/6/MSO6B) | Write to file + transfer | Medium | Medium |

---

## Method 1: HARDCOPY:DATA? (Direct Stream - LEGACY ONLY)

**Supported Models:** MSO/DPO 5k/7k/70k series ONLY

### Advantages
- ✅ Fastest method (no file I/O on scope)
- ✅ No need to manage files on scope
- ✅ Simplest code
- ✅ No temp file cleanup needed

### Python Example
```python
# Set format and layout
scope.write("HARDCopy:FORMat PNG")
scope.write("HARDCopy:LAYout PORTrait")

# Query image data directly
image_data = scope.query_binary_values('HARDCopy:DATA?', datatype='B', container=bytes)

# Save to PC
with open("screenshot.png", "wb") as f:
    f.write(bytes(image_data))
```

### ⚠️ CRITICAL NOTES
- **ONLY for MSO/DPO 5k/7k/70k** (Legacy scopes)
- **DOES NOT WORK on MSO5/6/MSO6B** (Modern scopes)
- Modern scopes don't support HARDCOPY:DATA?
- This is the FASTEST method for legacy scopes

---

## Method 2: HARDCOPY PORT FILE (Save + Transfer - LEGACY ONLY)

**Supported Models:** MSO/DPO 5k/7k/70k series ONLY

### Advantages
- ✅ Works on all legacy scopes
- ✅ Can verify file exists before transfer
- ✅ Image stays on scope if needed
- ✅ Proven working method

### Python Example (CURRENT IMPLEMENTATION)
```python
import os
import time
os.makedirs("./screenshots", exist_ok=True)

# Define paths
local_file = "./screenshots/screenshot.png"
scope_temp = "C:/TekScope/Temp/screenshot.png"

# Create directories on scope
try:
    scope.write('FILESYSTEM:MKDIR "C:/TekScope"')
except:
    pass
try:
    scope.write('FILESYSTEM:MKDIR "C:/TekScope/Temp"')
except:
    pass

# Configure hardcopy to save to file
scope.write('HARDCOPY:PORT FILE')
scope.write('HARDCOPY:FORMAT PNG')  # ← Fixed
scope.write(f'HARDCOPY:FILENAME "{scope_temp}"')
scope.write('HARDCOPY START')
time.sleep(1.0)  # Wait for hardcopy to complete

# Transfer file from scope to PC
old_timeout = scope.timeout
scope.timeout = 30000  # 30 seconds for file transfer
scope.write(f'FILESYSTEM:READFILE "{scope_temp}"')
image_data = scope.read_raw()
scope.timeout = old_timeout  # Restore original timeout

# Save to PC
with open(local_file, 'wb') as f:
    f.write(image_data)

# Delete temp file from scope
scope.write(f'FILESYSTEM:DELETE "{scope_temp}"')
print(f"Saved screenshot to {local_file}")
```

### ⚠️ CRITICAL NOTES
- **ONLY for MSO/DPO 5k/7k/70k** (Legacy scopes)
- **DOES NOT WORK on MSO5/6/MSO6B** (Modern scopes)
- Requires FILESYSTEM:READFILE command
- C:/TekScope/Temp path is proven to work on legacy scopes
- Use `time.sleep(1.0)` instead of `*OPC?` to avoid Unicode decode errors

---

## Method 3: SAVE:IMAGE + FILESYSTEM (Modern Scopes ONLY)

**Supported Models:** MSO5, MSO6, MSO5B, MSO6B series

### Advantages
- ✅ Official method for modern scopes
- ✅ Can verify file exists before transfer
- ✅ Image stays on scope if needed
- ✅ Supports multiple formats

### Python Example (CURRENT IMPLEMENTATION)
```python
import os
import time
os.makedirs("./screenshots", exist_ok=True)

# Define paths
local_file = "./screenshots/screenshot.png"
scope_temp = "C:/Temp/TekAutomate_Temp.png"

# Create temp directory on scope
try:
    scope.write('FILESYSTEM:MKDIR "C:/Temp"')
except:
    pass  # Directory may already exist

# Save image on scope
scope.write('SAVE:IMAGE:COMPOSITION NORMAL')
scope.write(f'SAVE:IMAGE "{scope_temp}"')
time.sleep(1.0)  # Wait for save to complete

# Transfer file from scope to PC
old_timeout = scope.timeout
scope.timeout = 30000  # 30 seconds for file transfer
scope.write(f'FILESYSTEM:READFILE "{scope_temp}"')
image_data = scope.read_raw()
scope.timeout = old_timeout  # Restore original timeout

# Save to PC
with open(local_file, 'wb') as f:
    f.write(image_data)

# Delete temp file from scope
scope.write(f'FILESYSTEM:DELETE "{scope_temp}"')
print(f"Saved screenshot to {local_file}")
```

### ⚠️ CRITICAL NOTES
- **ONLY for MSO5/6/MSO5B/MSO6B** (Modern scopes)
- **DOES NOT WORK on MSO/DPO 5k/7k/70k** (Legacy scopes)
- Legacy scopes use HARDCOPY commands instead
- Use `time.sleep(1.0)` to wait for save completion
- C:/Temp is the recommended path for modern scopes

---

## Common Errors and Solutions

### Error: UnicodeDecodeError: 'ascii' codec can't decode byte 0xe5...

**Cause:** Using `query('*OPC?')` after FILESYSTEM:READFILE - the PNG data is still in the buffer

**Solution:** Use `time.sleep(1.0)` instead of `*OPC?` after HARDCOPY START or SAVE:IMAGE

### Error: OSError: exception: access violation reading 0x...

**Cause:** FILESYSTEM:READFILE called too soon before save completed

**Solution:** Add `time.sleep(1.0)` after `SAVE:IMAGE` or `HARDCOPY START` command

### Error: Timeout on HARDCOPY:DATA?

**Cause:** Using HARDCOPY:DATA? on modern scope (MSO5/6)

**Solution:** Use SAVE:IMAGE + FILESYSTEM instead (modern scopes don't support HARDCOPY)

### Error: HARDCOPY:FORMAT ${format}

**Cause:** Bug in code generator (now fixed)

**Solution:** Update pythonGenerators.ts line 1264

---

## Which Method to Use?

### For Legacy Scopes (MSO/DPO 5k/7k/70k):
1. **HARDCOPY:DATA?** - Fastest, simplest (RECOMMENDED)
2. **HARDCOPY PORT FILE** - Slower but proven

### For Modern Scopes (MSO5/6/MSO6B):
1. **SAVE:IMAGE + FILESYSTEM** - Only option (REQUIRED)
2. **HARDCOPY commands will NOT work**

---

## Implementation Status

### Current TekAutomate Implementation:
- ✅ Method 2 (HARDCOPY PORT FILE) - Legacy - **NOW FIXED**
- ✅ Method 3 (SAVE:IMAGE + FILESYSTEM) - Modern - **WORKING**
- ❌ Method 1 (HARDCOPY:DATA?) - Not implemented (could add as optimization)

### Recommended Improvements:
1. ✅ Fix HARDCOPY:FORMAT bug (DONE)
2. ⚠️ Consider adding HARDCOPY:DATA? for legacy scopes (faster)
3. ✅ Document scope type compatibility clearly

---

## References

- Tektronix Programmer Manual 077001026 (DPO5000/DPO7000 series)
- Tektronix MSO5/6 Programmer Manual 077189801
- TekAutomate Documentation: TekAcademy_Export/measurements_commands/hardcopy_vs_filesystem.md
