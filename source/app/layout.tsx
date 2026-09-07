import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '认知实验任务平台',
  description: '面向学校与实验室现场测试的认知任务管理、运行与CSV导出工具。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body data-design-seed="protocol-ledger">
    {/*
      THESIS: 让实验助手以一条清晰、可追溯的流程完成儿童认知测试。
      OWN-WORLD: 学校实验室中的任务协议夹与数据台账。
      STORY: 学生登记，选择项目，安静测试，服务器保存，管理员按项目导出。
      FIRST VIEWPORT: 学生信息登记；后台账号密码登录。
      FORM: operate / protocol-ledger；灰白、深蓝、精确分栏和克制状态色。
      FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
    */}
    {children}
  </body></html>;
}
