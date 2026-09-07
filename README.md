# 认知实验任务平台

网站入口：https://1879124946z-stack.github.io/

## 发布状态
GitHub Pages 目前显示“测试暂未开放”。它不能运行本项目服务器、管理员鉴权和集中数据库，因此目前不能用于正式采集。大陆访问需要实际网络验证。

## 源码
source/ 包含学生页面、管理员页面、伦敦塔等实验和独立数据服务器。现有版本仍要求学号、年龄、性别和年级，尚未实现仅编号登记及逐题断点恢复。代码公开不表示这些新需求已完成。

本机运行需要 Node.js 24 和 pnpm：

```sh
cd source
pnpm install --frozen-lockfile
pnpm setup:mainland
pnpm dev:mainland
```

详见 source/DEPLOYMENT.md。管理员信息在初始化时生成于私有 .data 目录，不能上传此目录、学生记录、密钥、备份或 .env。

原创代码使用 MIT 许可证，第三方依赖保留各自许可证。实验的科研效度需要另行确认。
