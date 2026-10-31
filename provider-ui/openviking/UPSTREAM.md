# OpenViking source integration
Source: https://github.com/volcengine/OpenViking/tree/20f9c11362ad16193b0daa4a414e1095061af427/web-studio
Version: 0.5.0. License retained in LICENSE.upstream.
The official source is vendored, not recreated. Platform-specific code lives in src/platform.
Adaptations: application/user connection provider; scoped platform transport and storage;
root layout without upstream shell; shared UI exports; portal container; supported routes.
The platform imports this React library directly. There is no iframe or secondary React root.
