import { Card, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

export default function AboutPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-white to-gray-100 p-6">
      <div className="w-full max-w-4xl">
        <Card className="rounded-2xl shadow-lg overflow-hidden border border-gray-200 bg-white">
          <div className="flex flex-col md:flex-row items-stretch">

            {/* 左侧 Hero */}
            <div className="md:w-1/2 p-8 bg-linear-to-b from-gray-900 to-gray-800 text-white">
              <div className="flex items-center gap-4 mb-4">
                <Avatar className="w-12 h-12 ring-2 ring-white/20">
                  <AvatarImage
                    src="https://avatars.githubusercontent.com/u/108108024?s=200&v=4"
                    alt="@mfavant"
                  />
                </Avatar>
                <div>
                  <h2 className="text-sm uppercase tracking-wide opacity-80">关于 novi</h2>
                  <Badge className="mt-1 bg-white/10 text-white border-white/20">
                    端对端加密 · 隐私优先
                  </Badge>
                </div>
              </div>

              <CardTitle className="text-3xl font-extrabold leading-tight">novi, no way.</CardTitle>
              <CardDescription className="mt-3 text-gray-300">
                Each friendship, a unique encryption pair the platform can never see.
              </CardDescription>

              <p className="mt-6 text-sm text-gray-300/90 leading-relaxed">
                我们相信隐私是基础，而非附加。所有密钥对均由客户端生成，服务器无法读取任何内容。
              </p>
            </div>

            {/* 右侧内容 */}
            <div className="md:w-1/2 p-8 bg-white">
              <CardContent>
                <h3 className="text-lg font-semibold text-gray-900">我们的理念</h3>
                <p className="mt-3 text-sm text-gray-600 leading-relaxed">
                  用户控制权永远优先。无后门、无托管式密钥，只有聊天双方设备能解密内容。
                </p>

                <Separator className="my-6" />

                <div className="grid grid-cols-1 gap-5">

                  {/* 加密信任 */}
                  <div className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 text-xs">
                      📧
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">加密信任</h4>
                      <p className="text-xs text-gray-500">
                        每段友谊生成独立密钥对，服务端无法参与解密。
                      </p>
                    </div>
                  </div>

                  {/* 隐私优先 */}
                  <div className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 text-xs">
                      🔒
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">隐私优先</h4>
                      <p className="text-xs text-gray-500">
                        尽量减少收集敏感信息，仅保留最低限度的数据。
                      </p>
                    </div>
                  </div>

                  {/* 轻量可用 */}
                  <div className="flex items-start gap-4">
                    <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-gray-700 text-xs">
                      ⚡
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">轻量与可用</h4>
                      <p className="text-xs text-gray-500">
                        客户端优先、界面简洁，移动端与桌面端均友好。
                      </p>
                    </div>
                  </div>
                </div>

                <Separator className="my-6" />

                {/* 联系我们 + 按钮 */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">有问题？联系我们</p>
                    <p className="text-sm font-medium text-gray-800">
                      heizuboriyo@gmail.com
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <Button variant="ghost" className="text-gray-700" asChild>
                      <a href="mailto:heizuboriyo@gmail.com">发邮件</a>
                    </Button>

                    <Button asChild className="bg-gray-900 hover:bg-black text-white">
                      <Link to="/signup">开始使用</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </div>

          </div>
        </Card>
      </div>
    </div>
  );
}
