Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class TerminalVibeProcesses {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct Entry {
  public uint size, usage, pid; public UIntPtr heap;
  public uint module, threads, parent; public int priority; public uint flags;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name;
 }
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static string Snapshot() {
  IntPtr handle=CreateToolhelp32Snapshot(2,0);
  if(handle==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception();
  try {
   Entry entry=new Entry(); entry.size=(uint)Marshal.SizeOf(typeof(Entry));
   if(!Process32FirstW(handle,ref entry)) throw new System.ComponentModel.Win32Exception();
   StringBuilder output=new StringBuilder();
   do { output.Append(entry.pid).Append(':').Append(entry.parent).Append(':').Append(entry.name).Append('\n'); }
   while(Process32NextW(handle,ref entry));
   return output.ToString();
  } finally { CloseHandle(handle); }
 }
}
"@
while ($null -ne [Console]::ReadLine()) {
 try { [Console]::Write([TerminalVibeProcesses]::Snapshot()) }
 catch { [Console]::WriteLine('ERROR') }
 [Console]::WriteLine('END')
 [Console]::Out.Flush()
}
