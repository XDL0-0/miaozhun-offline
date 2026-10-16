using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class OfflineLauncher
{
    private const string AppUrl = "http://127.0.0.1:18746/aim";
    private const string HealthUrl = "http://127.0.0.1:18746/__offline/health";

    [STAThread]
    private static void Main()
    {
        try
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            if (!IsServerReady())
            {
                string node = Path.Combine(directory, "runtime", "node.exe");
                string server = Path.Combine(directory, "server.mjs");
                if (!File.Exists(node) || !File.Exists(server))
                    throw new FileNotFoundException("离线运行文件不完整。请保留 runtime 文件夹和 server.mjs，并将它们放在启动器旁边。");

                Process.Start(new ProcessStartInfo
                {
                    FileName = node,
                    Arguments = "\"" + server + "\"",
                    WorkingDirectory = directory,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                });

                Stopwatch timer = Stopwatch.StartNew();
                bool ready = false;
                while (timer.ElapsedMilliseconds < 10000)
                {
                    int remaining = (int)(10000 - timer.ElapsedMilliseconds);
                    if (IsServerReady(Math.Max(1, Math.Min(500, remaining))))
                    {
                        ready = true;
                        break;
                    }
                    remaining = (int)(10000 - timer.ElapsedMilliseconds);
                    if (remaining > 0)
                        Thread.Sleep(Math.Min(100, remaining));
                }
                if (!ready)
                    throw new InvalidOperationException("离线服务未能在 10 秒内启动。请确认文件完整，且端口 18746 未被其他程序占用，然后重试。");
            }

            string edge = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(edge))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = edge,
                    Arguments = "--app=" + AppUrl + " --no-first-run",
                    WorkingDirectory = directory,
                    UseShellExecute = true
                });
            }
            else
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = AppUrl,
                    UseShellExecute = true
                });
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "瞄准专家离线版启动失败",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static bool IsServerReady(int timeout = 500)
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(HealthUrl);
            request.Proxy = null;
            request.AllowAutoRedirect = false;
            request.Timeout = timeout;
            request.ReadWriteTimeout = timeout;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                if (response.StatusCode != HttpStatusCode.OK)
                    return false;
                using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                {
                    char[] buffer = new char[2048];
                    int count = reader.Read(buffer, 0, buffer.Length);
                    string body = new string(buffer, 0, count);
                    return body.IndexOf("aim-offline", StringComparison.Ordinal) >= 0
                        && body.IndexOf("\"ready\":true", StringComparison.Ordinal) >= 0;
                }
            }
        }
        catch
        {
            return false;
        }
    }
}
