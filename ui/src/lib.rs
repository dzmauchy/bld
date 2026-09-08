use leptos::prelude::*;

#[component]
pub fn App() -> impl IntoView {
    let sum = bld_core::add(2, 2);

    view! {
        <p>{sum}</p>
    }
}
