//! Squarefolk 数据工坊 —— Tauri 2 后端（design §6.1 M4）。
//!
//! 职责边界：本文件**只做文件 I/O 与 git 只读查询**，不实现任何规则/校验
//! （校验 = webview 里跑 tools/validate-core.mjs 纯核心；红线：编辑器禁止重实现规则）。
//!
//! 命令集（MVP 最小）：
//!   read_data_file(name)              读 data/ 下白名单 .json（含 schemas/，前端校验要用）
//!   write_data_file(name, content)    写 data/ 五件内容文件（白名单更严：仅五件，防误写 schema）
//!   git_show_head(path)               `git show HEAD:<path>` 只读输出，供 diff 面板
//!
//! 安全：所有路径先过字面白名单（禁 `..`、禁绝对路径、只允许 `.json`），
//! 再 canonicalize 后要求仍落在 data/ 之内（防符号链接穿越）。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 五件内容文件（唯一可写集合 —— design 红线：可调数值只在 data/）
const CONTENT_FILES: [&str; 5] = [
    "units.json",
    "techs.json",
    "improvements.json",
    "resources.json",
    "balance.json",
];

/// 仓库根 = 含 data/units.json 的最近上级目录（从 CWD 走：tauri dev 的 CWD 是 src-tauri/）
fn repo_root() -> Result<PathBuf, String> {
    let mut dir = std::env::current_dir().map_err(|e| e.to_string())?;
    loop {
        if dir.join("data").join("units.json").is_file() {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err("找不到仓库根（未命中 data/units.json）".into());
        }
    }
}

/// 白名单校验：`name` 必须是 data/ 相对路径下的 .json，无穿越成分。
/// `allow_schemas` 时允许 `schemas/` 前缀（读）；写路径永远不允许。
fn resolve_data_file(root: &Path, name: &str, allow_schemas: bool) -> Result<PathBuf, String> {
    let ok_name = |n: &str| {
        !n.is_empty()
            && n.ends_with(".json")
            && !n.contains("..")
            && !n.contains('\\')
            && n.split('/').all(|seg| {
                !seg.is_empty()
                    && seg != "."
                    && seg.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
            })
    };
    // split('/') 对 schemas/x.json 给 ["schemas","x.json"]，逐段字符白名单覆盖前缀情形
    let rel = name;
    if !ok_name(rel) {
        return Err(format!("路径不合法（仅 data/ 下 .json，禁穿越）：{name}"));
    }
    if rel.starts_with("schemas/") && !allow_schemas {
        return Err(format!("此操作不允许访问 schemas/：{name}"));
    }
    let data_dir = root.join("data");
    let candidate = data_dir.join(&rel);
    // 字面白名单已过；再做 canonicalize 兜底（存在性 + 防符号链接逃出 data/）
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("打不开 {name}：{e}"))?;
    let data_canon = data_dir
        .canonicalize()
        .map_err(|e| format!("打不开 data/：{e}"))?;
    if !canonical.starts_with(&data_canon) {
        return Err(format!("路径逃出 data/ 目录：{name}"));
    }
    Ok(canonical)
}

/// 白名单内的写目标：仅五件内容文件，schemas 只读
fn resolve_write_file(root: &Path, name: &str) -> Result<PathBuf, String> {
    if !CONTENT_FILES.contains(&name) {
        return Err(format!(
            "只允许写五件内容文件（{}），拒绝：{name}",
            CONTENT_FILES.join(" / ")
        ));
    }
    let data_dir = root.join("data");
    let candidate = data_dir.join(name);
    // 写目标可能尚不存在，不做 canonicalize；字面白名单已排除穿越
    if candidate.parent() != Some(data_dir.as_path()) {
        return Err(format!("路径不合法：{name}"));
    }
    Ok(candidate)
}

#[tauri::command]
fn read_data_file(name: String) -> Result<String, String> {
    let root = repo_root()?;
    let path = resolve_data_file(&root, &name, true)?;
    fs::read_to_string(&path).map_err(|e| format!("读 {name} 失败：{e}"))
}

#[tauri::command]
fn write_data_file(name: String, content: String) -> Result<(), String> {
    let root = repo_root()?;
    let path = resolve_write_file(&root, &name)?;
    fs::write(&path, content).map_err(|e| format!("写 {name} 失败：{e}"))
}

#[tauri::command]
fn git_show_head(path: String) -> Result<String, String> {
    let root = repo_root()?;
    // git 路径形如 data/units.json —— 白名单同 data/ 相对 .json
    let rel = path
        .strip_prefix("data/")
        .ok_or_else(|| format!("仅支持 data/ 下路径：{path}"))?;
    resolve_data_file(&root, rel, true)?;
    let out = Command::new("git")
        .current_dir(&root)
        .args(["show", &format!("HEAD:{path}")])
        .output()
        .map_err(|e| format!("git show 执行失败：{e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git show HEAD:{path} 失败：{}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    String::from_utf8(out.stdout).map_err(|e| format!("git 输出非 UTF-8：{e}"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            read_data_file,
            write_data_file,
            git_show_head
        ])
        .run(tauri::generate_context!())
        .expect("数据工坊启动失败");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> PathBuf {
        // 测试 CWD = src-tauri/，仓库根在三级之上
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    #[test]
    fn read_accepts_content_and_schema_files() {
        let r = root();
        assert!(resolve_data_file(&r, "units.json", true).is_ok());
        assert!(resolve_data_file(&r, "schemas/units.schema.json", true).is_ok());
    }

    #[test]
    fn read_rejects_traversal_absolute_and_non_json() {
        let r = root();
        for bad in [
            "../secrets.json",
            "..",
            "/etc/hosts",
            "units.json/../techs.json",
            "units.txt",
            "",
            "schemas\\units.schema.json",
        ] {
            assert!(
                resolve_data_file(&r, bad, true).is_err(),
                "应拒绝读路径：{bad}"
            );
        }
    }

    #[test]
    fn write_whitelist_is_only_five_content_files() {
        let r = root();
        for ok in CONTENT_FILES {
            assert!(resolve_write_file(&r, ok).is_ok(), "应允许写：{ok}");
        }
        for bad in ["schemas/units.schema.json", "evil.json", "../units.json", ""] {
            assert!(
                resolve_write_file(&r, bad).is_err(),
                "应拒绝写路径：{bad}"
            );
        }
    }
}
