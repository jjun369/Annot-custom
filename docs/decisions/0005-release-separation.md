# ADR 0005: Private source and public releases

Status: Accepted

Source remains in private `Annot-custom`. Public `jjun369/PageDock-Releases` contains only signed/unsigned installer artifacts and update metadata. Automatic-update configuration points to the public release repository; publishing requires a narrowly scoped release token stored as a private repository secret.
